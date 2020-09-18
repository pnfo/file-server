export the list of files/books

select a.name, a.desc, a.type, b.name as folder, a.date_added, a.size, a.downloads 
from entry a 
JOIN entry b ON a.folder=b.ROWID where a.is_deleted=0 and a.type!='coll' 