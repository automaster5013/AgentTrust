import {basename,extname} from 'node:path';

// Report destinations must be ordinary files on both Windows and POSIX hosts.
// A colon in the final component can select an NTFS alternate data stream.
export function isOrdinaryHtmlOutput(path){
 if(typeof path!=='string'||!path.trim()||extname(path).toLowerCase()!=='.html')return false;
 const name=basename(path),stem=name.split('.')[0].trimEnd();
 return !/[\u0000-\u001f\u007f<>:"/\\|?*]/.test(name)&&!/[. ]$/.test(name)&&
  !/^(con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])$/i.test(stem);
}
