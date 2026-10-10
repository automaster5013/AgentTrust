"""Let the real 60-second project quota expire between intensive CI fixtures."""
import json,time
time.sleep(62)
print(json.dumps({'naturalQuotaWindowElapsed':True,'quotaLimitsChanged':False,'redisEntriesDeleted':False}))
