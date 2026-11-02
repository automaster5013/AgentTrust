import {realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {parseLegacyCatalogueArguments} from './stack-legacy-catalogue.mjs';
import {legacyCatalogueHtmlFromFiles} from '../packages/stack-legacy-link/catalogue-report.js';
function isMain(){try{return !!process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href}catch{return false}}
if(isMain()){
 try{process.stdout.write(await legacyCatalogueHtmlFromFiles(parseLegacyCatalogueArguments(process.argv.slice(2))))}
 catch{console.error('Legacy catalogue report failed. Supply original regular input files and independent catalogue, mapping, public-key and target expectations.');process.exitCode=2;}
}
