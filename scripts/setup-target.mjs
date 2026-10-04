// Setup is a local bootstrap command. Validate every connection before Docker or DDL.
export function validateLocalSetup(env){
  try{
    const port=(value,fallback)=>{const text=value??fallback;if(typeof text!=='string'||!/^\d{4,5}$/.test(text)||String(Number(text))!==text||Number(text)<1024||Number(text)>65535)throw Error();return text;};
    const apiPort=port(env.PORT,'4310'),dbPort=port(env.DB_PORT,'55432');if(apiPort===dbPort)throw Error();
    for(const [prefix,role,key] of [['OWNER_','owner','DB_OWNER_PASSWORD'],['','api','DB_API_PASSWORD'],['WORKER_','worker','DB_WORKER_PASSWORD']]){
      const password=env[key];if(typeof password!=='string'||!/^[a-f0-9]{48}$/.test(password))throw Error();
      for(const [test,db] of [['','agenttrust'],['TEST_','agenttrust_test']]){
        const text=env[test+prefix+'DATABASE_URL'];if(typeof text!=='string'||text!==text.trim())throw Error();
        const url=new URL(text);
        if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.port!==dbPort||url.username!=='agenttrust_'+role||url.password!==password||url.pathname!=='/'+db||url.search||url.hash)throw Error();
      }
    }
    return {localDatabaseConfigurationVerified:true,apiPort:Number(apiPort),databasePort:Number(dbPort)};
  }catch{throw new Error('Invalid local database configuration. Preserve .env and review the generated loopback URLs, roles, distinct main/test databases and matching ports.');}
}
