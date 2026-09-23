export default async function(){try{await fetch('http://127.0.0.1:4174/__test_shutdown',{method:'POST'});}catch{/* Already stopped. */}}
