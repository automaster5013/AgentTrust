package main

import (
	"io"
	"net/http"
	"os"
	"time"
)

func main() {
	if len(os.Args) != 2 {
		os.Exit(1)
	}
	endpoint := ""
	switch os.Args[1] {
	case "tempo":
		endpoint = "http://127.0.0.1:3200/ready"
	case "loki":
		endpoint = "http://127.0.0.1:3100/ready"
	default:
		os.Exit(1)
	}
	client := &http.Client{Timeout: 2 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Get(endpoint)
	if err != nil {
		os.Exit(1)
	}
	defer response.Body.Close()
	_, err = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	if err != nil || response.StatusCode != http.StatusOK {
		os.Exit(1)
	}
}
