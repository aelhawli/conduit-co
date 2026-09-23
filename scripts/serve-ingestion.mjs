import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const files={'/':['index.html','text/html'],'/ingestion.js':['ingestion.js','text/javascript'],'/ingestion.css':['ingestion.css','text/css'],'/logo.png':['logo.png','image/png']};
const server=createServer(async(req,res)=>{
 if(req.method==='POST'&&req.url==='/__test_shutdown'){res.writeHead(204);res.end();server.close();return;}
 const file=files[new URL(req.url,'http://localhost').pathname];if(!file){res.writeHead(404);res.end();return;}
 try{res.writeHead(200,{'Content-Type':file[1]});res.end(await readFile('dist/ingestion-web/'+file[0]));}catch{res.writeHead(500);res.end();}
});
server.listen(4174,'127.0.0.1');
