import {spawn} from 'node:child_process';
import {existsSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const local=fileURLToPath(new URL('../data/tools/twitch-cli/bin/',import.meta.url));
let executable='twitch';
if(process.platform==='win32'&&existsSync(local)){
 const folder=readdirSync(local,{withFileTypes:true}).find(entry=>entry.isDirectory()&&existsSync(path.join(local,entry.name,'twitch.exe')));
 if(folder)executable=path.join(local,folder.name,'twitch.exe');
}
const child=spawn(executable,process.argv.slice(2),{stdio:'inherit',windowsHide:true});
child.on('error',error=>{console.error(error.code==='ENOENT'?'Install the official Twitch CLI and add it to PATH: https://dev.twitch.tv/docs/cli/':error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
