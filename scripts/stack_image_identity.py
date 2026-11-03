"""Cached Docker identity binding for classic and containerd image stores.
Caller must independently authenticate the registry manifest -> config digest chain.
"""
import re
MEDIA={'application/vnd.oci.image.manifest.v1+json','application/vnd.oci.image.index.v1+json','application/vnd.docker.distribution.manifest.v2+json','application/vnd.docker.distribution.manifest.list.v2+json'}
def require(value):
 if not value:raise ValueError('Cached image identity refused')
def cached_identity(image,reference,expected_config):
 require(re.fullmatch('docker.io/automaster5013/agenttrust-[a-z-]+@sha256:[a-f0-9]{64}',reference))
 require(re.fullmatch('sha256:[a-f0-9]{64}',expected_config))
 digest=reference.split('@')[1]
 require(reference.removeprefix('docker.io/') in {v.removeprefix('docker.io/') for v in image['RepoDigests']})
 require(image['Os']=='linux' and image['Architecture']=='amd64')
 if image['Id']==expected_config:return 'config-id'
 descriptor=image.get('Descriptor',{})
 require(image['Id']==digest and descriptor.get('digest')==digest and descriptor.get('mediaType') in MEDIA)
 return 'manifest-descriptor'
