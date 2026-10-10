// Provision only the isolated synthetic evidence bucket and restricted application user.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	madmin "github.com/minio/madmin-go/v3"
	minio "github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

const bucket = "stack-evidence"

var phase = "configuration"
var storageErrorCode = ""

func secret(name string) string {
	data, err := os.ReadFile("/run/secrets/" + name)
	if err != nil {
		panic("PRIVATE_CONFIGURATION_UNAVAILABLE")
	}
	return string(data)
}
func provision() error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	rootUser, rootPassword := secret("stack-minio-root-user"), secret("stack-minio-root-password")
	user, password := secret("stack-minio-user"), secret("stack-minio-password")
	if rootUser != "stack-root" || user != "stack-evidence" || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(rootPassword) || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(password) {
		return fmt.Errorf("PRIVATE_CONFIGURATION_INVALID")
	}
	transport := &http.Transport{ResponseHeaderTimeout: 5 * time.Second}
	client, err := minio.New("stack-object-store:9000", &minio.Options{Creds: credentials.NewStaticV4(rootUser, rootPassword, ""), Secure: false, Region: "us-east-1", Transport: transport})
	if err != nil {
		return err
	}
	exists, err := client.BucketExists(ctx, bucket)
	if err != nil {
		return err
	}
	if !exists {
		if err = client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{Region: "us-east-1", ObjectLocking: true}); err != nil {
			return err
		}
	}
	mode, days, unit := minio.Compliance, uint(7), minio.Days
	if err = client.SetBucketObjectLockConfig(ctx, bucket, &mode, &days, &unit); err != nil {
		return err
	}
	enabled, actualMode, actualDays, actualUnit, err := client.GetObjectLockConfig(ctx, bucket)
	if err != nil || enabled != "Enabled" || actualMode == nil || *actualMode != mode || actualDays == nil || *actualDays != days || actualUnit == nil || *actualUnit != unit {
		return fmt.Errorf("RETENTION_UNVERIFIED")
	}
	admin, err := madmin.New("stack-object-store:9000", rootUser, rootPassword, false)
	if err != nil {
		return err
	}
	policy := []byte(`{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:GetBucketLocation"],"Resource":["arn:aws:s3:::stack-evidence"]},{"Effect":"Allow","Action":["s3:GetObject","s3:GetObjectVersion","s3:PutObject"],"Resource":["arn:aws:s3:::stack-evidence/organizations/*"]}]}`)
	if err = admin.AddCannedPolicy(ctx, "stack-evidence-app", policy); err != nil {
		return err
	}
	if err = admin.AddUser(ctx, user, password); err != nil {
		return err
	}
	info, err := admin.GetUserInfo(ctx, user)
	if err != nil {
		return err
	}
	attached := false
	for _, name := range strings.Split(info.PolicyName, ",") {
		if name == "stack-evidence-app" {
			attached = true
		}
	}
	if !attached {
		if _, err = admin.AttachPolicy(ctx, madmin.PolicyAssociationReq{Policies: []string{"stack-evidence-app"}, User: user}); err != nil {
			return err
		}
	}
	if err = admin.SetBucketQuota(ctx, bucket, &madmin.BucketQuota{Quota: 268435456, Type: madmin.HardQuota}); err != nil {
		return err
	}
	return nil
}
func verify() error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var input struct {
		Key     string `json:"key"`
		Version string `json:"version"`
		Hash    string `json:"hash"`
		Bytes   int64  `json:"bytes"`
	}
	if err := json.NewDecoder(io.LimitReader(os.Stdin, 8192)).Decode(&input); err != nil {
		return err
	}
	if !regexp.MustCompile(`^organizations/[a-f0-9-]{36}/projects/[a-f0-9-]{36}/(?:runs|campaigns)/[a-f0-9-]{36}/[a-f0-9]{64}\.json$`).MatchString(input.Key) || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(input.Hash) || !regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`).MatchString(input.Version) || input.Bytes < 1 || input.Bytes > 16384 {
		return fmt.Errorf("INVALID_FIXTURE")
	}
	app, err := minio.New("stack-object-store:9000", &minio.Options{Creds: credentials.NewStaticV4(secret("stack-minio-user"), secret("stack-minio-password"), ""), Secure: false, Region: "us-east-1"})
	if err != nil {
		return err
	}
	root, err := minio.New("stack-object-store:9000", &minio.Options{Creds: credentials.NewStaticV4(secret("stack-minio-root-user"), secret("stack-minio-root-password"), ""), Secure: false, Region: "us-east-1"})
	if err != nil {
		return err
	}
	check := func() error {
		object, e := app.GetObject(ctx, bucket, input.Key, minio.GetObjectOptions{VersionID: input.Version})
		if e != nil {
			return e
		}
		defer object.Close()
		data, e := io.ReadAll(io.LimitReader(object, 16385))
		if e != nil {
			return e
		}
		hash := sha256.Sum256(data)
		if int64(len(data)) != input.Bytes || hex.EncodeToString(hash[:]) != input.Hash {
			return fmt.Errorf("HASH_MISMATCH")
		}
		return nil
	}
	if err = check(); err != nil {
		return err
	}
	phase = "global-list-restriction"
	listed, listError := app.ListBuckets(ctx)
	if listError == nil {
		for _, entry := range listed {
			if entry.Name != bucket {
				return fmt.Errorf("GLOBAL_BUCKETS_EXPOSED")
			}
		}
	} else if minio.ToErrorResponse(listError).Code != "AccessDenied" {
		return fmt.Errorf("GLOBAL_LIST_UNVERIFIED")
	}
	phase = "object-list-refusal"
	refused := false
	for entry := range app.ListObjects(ctx, bucket, minio.ListObjectsOptions{Prefix: "organizations/", Recursive: true}) {
		if minio.ToErrorResponse(entry.Err).Code == "AccessDenied" {
			refused = true
			break
		}
		return fmt.Errorf("OBJECT_LIST_NOT_REFUSED")
	}
	if !refused {
		return fmt.Errorf("OBJECT_LIST_UNVERIFIED")
	}
	phase = "application-delete-refusal"
	if err = app.RemoveObject(ctx, bucket, input.Key, minio.RemoveObjectOptions{VersionID: input.Version}); minio.ToErrorResponse(err).Code != "AccessDenied" {
		return fmt.Errorf("APPLICATION_DELETE_NOT_REFUSED")
	}
	phase = "retention"
	mode, until, err := root.GetObjectRetention(ctx, bucket, input.Key, input.Version)
	if err != nil || mode == nil || *mode != minio.Compliance || until == nil || until.Before(time.Now().Add(6*24*time.Hour)) {
		return fmt.Errorf("RETENTION_UNVERIFIED")
	}
	phase = "root-delete-refusal"
	err = root.RemoveObject(ctx, bucket, input.Key, minio.RemoveObjectOptions{VersionID: input.Version})
	storageErrorCode = minio.ToErrorResponse(err).Code
	if storageErrorCode != "InvalidRequest" || minio.ToErrorResponse(err).Message != "Object is WORM protected and cannot be overwritten" || minio.ToErrorResponse(err).StatusCode != 400 {
		return fmt.Errorf("COMPLIANCE_DELETE_NOT_REFUSED")
	}
	if err = check(); err != nil {
		return err
	}
	phase = "shadow-version"
	shadow := []byte(`{"syntheticShadow":true}`)
	latest, err := root.PutObject(ctx, bucket, input.Key, bytes.NewReader(shadow), int64(len(shadow)), minio.PutObjectOptions{ContentType: "application/json"})
	if err != nil || latest.VersionID == input.Version {
		return fmt.Errorf("SHADOW_FIXTURE_UNVERIFIED")
	}
	if err = check(); err != nil {
		return err
	}
	json.NewEncoder(os.Stdout).Encode(map[string]any{"completed": true, "applicationDeleteAndObjectListRefused": true, "globalBucketListRestricted": true, "rootCannotDeleteLockedVersion": true, "retentionMode": "COMPLIANCE", "retentionDays": 7, "specificVersionStillMatchesAfterNewerShadow": true, "syntheticFixture": true, "rawSecretsPrinted": false})
	return nil
}
func main() {
	if len(os.Args) == 2 && os.Args[1] == "--verify" {
		if err := verify(); err != nil {
			json.NewEncoder(os.Stdout).Encode(map[string]any{"completed": false, "code": "OBJECT_STORE_VERIFICATION_FAILED", "stage": phase, "failureType": fmt.Sprintf("%T", err), "storageErrorCode": storageErrorCode, "caughtStorageCode": minio.ToErrorResponse(err).Code})
			os.Exit(1)
		}
		return
	}
	if len(os.Args) != 1 {
		os.Exit(1)
	}
	if err := provision(); err != nil {
		fmt.Println(`{"completed":false,"code":"OBJECT_STORE_PROVISION_UNVERIFIED"}`)
		os.Exit(1)
	}
	json.NewEncoder(os.Stdout).Encode(map[string]any{"completed": true, "bucket": bucket, "objectLock": "COMPLIANCE", "retentionDays": 7, "applicationCanDelete": false, "rawSecretsPrinted": false})
}
