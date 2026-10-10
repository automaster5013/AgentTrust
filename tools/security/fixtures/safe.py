import subprocess
import requests
subprocess.run(['python', 'worker.py'], shell=False)
requests.get('https://example.invalid', verify=True)
