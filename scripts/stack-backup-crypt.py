"""Bounded AES-GCM stream helper for local development restore drills only."""
import argparse,pathlib,sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import secrets

LIMIT=64*1024*1024
MAGIC=b'AgentTrustRestoreDrill1\x00'
CONTEXT=b'agenttrust-development-restore-drill-v1'
PLAIN_LIMIT=LIMIT-len(MAGIC)-28

def transform(operation,key,data):
    if len(key)!=32 or not data or len(data)>LIMIT:raise ValueError('Invalid bounded input')
    if operation=='encrypt':
        if len(data)>PLAIN_LIMIT:raise ValueError('Plaintext exceeds envelope bound')
        nonce=secrets.token_bytes(12)
        return MAGIC+nonce+AESGCM(key).encrypt(nonce,data,CONTEXT)
    if operation!='decrypt' or not data.startswith(MAGIC) or len(data)<len(MAGIC)+29:
        raise ValueError('Invalid backup envelope')
    offset=len(MAGIC)
    return AESGCM(key).decrypt(data[offset:offset+12],data[offset+12:],CONTEXT)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation',choices=['encrypt','decrypt'])
    parser.add_argument('--key-file',type=pathlib.Path,required=True)
    args=parser.parse_args()
    try:
        if args.key_file.is_symlink() or not args.key_file.is_file() or args.key_file.stat().st_size!=32:
            raise ValueError('Invalid key file')
        result=transform(args.operation,args.key_file.read_bytes(),sys.stdin.buffer.read(LIMIT+1))
        sys.stdout.buffer.write(result)
    except Exception as error:
        # Never print keys, backup bytes or underlying exception messages.
        sys.stderr.write('BACKUP_STREAM_REFUSED '+type(error).__name__+'\n')
        return 1
    return 0

if __name__=='__main__':raise SystemExit(main())
