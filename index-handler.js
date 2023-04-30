/**
 * GUIDE
 * File name format - name[desc]{rowid}.type
 * Specify {rowid} for all files manually, including new files
 * reuse the rowid of the old file when replacing it with a new file, it will carry forward the download count and the links
 * 
 * update: 2020 april - rebuild index is now not recursive, mediafire code commented out
 * update: 2023 april - rebuild index now reads s3 buckets instead of filesystem, mediafire code deleted
 */
"use strict";

import fs from 'fs'
import vkb from 'vkbeautify'
import { S3Handler } from './s3-hander.js'

export const getDate = (date) => date.toISOString().split('T')[0];
const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function parseFileName(fileName) {
    // name[desc]{entryId}.type - [desc] is optional, {entryId} will have to filled to be the next available id
    const res = /^(.+?)(?:\[(.*)\])?(?:\{(\d+)\})?(?:\.(\w+))?$/.exec(fileName);
    if (!res) console.error(`File name ${fileName} can not be parsed`);
    return {name: res[1].trim(), desc: res[2] || '', id: res[3] || 0, type: res[4] || 'coll'};
}

function createFileName({name, desc, entryId, type}) {
    desc = desc ? `[${desc}]` : '';
    entryId = entryId ? `{${entryId}}` : '';
    type = type != 'coll' ? `.${type}` : '';
    return `${name}${desc}${entryId}${type}`;
}

function generateParents(prefix) {
    const parts = prefix.split('/')
    return parts.map((p, i) => ({...parseFileName(p), Key: parts.slice(0, i + 1).join('/')}))
}

export class IndexHandler {
    constructor(config) {
        this.config = config
        this.s3Hander = new S3Handler(config.s3RootFolder) 
        this.indexLoaded = false
        this.idInfoLastWrite = Date.now()
        this.indexStats = { numFiles: 0, numFolders: 0 }
    }

    async incrementDownloads(id) {
        if (!this.files[id]) return
        this.files[id].downloads++
        await this.checkWriteInfo(false)
    }
    async checkWriteInfo(forceWrite) {
        if (!this.indexLoaded) return // can't write anything until the index is first loaded
        if (forceWrite || this.idInfoLastWrite < Date.now() - 3600 * 1000) { // every one hour write to file
            const idToInfos = {}
            Object.entries(this.files).forEach(([id, {downloads, dateAdded}]) => idToInfos[id] = {downloads, dateAdded})
            await fs.promises.writeFile(this.config.idToInfoFile, vkb.json(JSON.stringify(idToInfos)), 'utf-8')
            this.idInfoLastWrite = Date.now()
        }
    }

    // read s3 completely and download stats and make an index
    async refreshIndex() {
        const entries = await this.s3Hander.list('', true) // get all

        await this.checkWriteInfo(true) // make sure to write any updates before reading
        const idToInfos = JSON.parse(fs.readFileSync(this.config.idToInfoFile, 'utf-8'))
        // if (this.indexLoaded) { // take any updated values from the existing index
        //     Object.entries(this.files).forEach(([id, {downloads}]) => idToInfos[id].downloads = downloads)
        // }
        this.folders = {}
        this.files = {}
        
        entries.forEach(e => {
            if (e.Key.endsWith('/')) return // ignore any folder entries
            const fileName = e.Key.split('/').slice(-1)[0], prefix = e.Key.split('/').slice(0, -1).join('/')
            const {name, desc, id, type} = parseFileName(fileName)
            if (!id) {
                return console.error(`file without id ignored ${e.Key}`)
            }
            if (this.files[id]) {
                return console.error(`id ${id} already exists in the entries list in ${e.Key} ignoring file`)
            }
            const parents = generateParents(prefix), 
                {downloads, dateAdded} = idToInfos[id] || {downloads: 0, dateAdded: getDate(new Date())}
            this.files[id] = {...e, name, desc, type, id, parents, downloads, dateAdded}

            parents.forEach(({name, id, Key}) => {
                if (this.folders[id]) {
                    this.folders[id].num_entries++
                    this.folders[id].Size += e.Size
                } else {
                    this.folders[id] = {name, id, num_entries: 1, Size: e.Size, Key, type: 'coll', parents: generateParents(Key)}
                }
            })
            
        });
        //console.log(this.files)
        //console.log(this.folders)
        this.indexLoaded = true

        const numFiles = Object.keys(this.files).length, numFolders = Object.keys(this.folders).length,
            nextEntryId = Math.max(...this.getAllEntries().map(({id}) => id)) + 1
        const stats = {numFiles, numFolders, nextEntryId, 
            numFilesChange: numFiles - this.indexStats.numFiles, 
            numFoldersChange: numFolders - this.indexStats.numFolders}
        console.log(`index reloaded with ${numFiles} files and ${numFolders} folders. next entry id ${nextEntryId}`)
        return this.indexStats = stats
    }
    
    isFolder(id) { return !!this.folders[id] }
    getFolder(id) { return id ? this.folders[id] : {parents: [], id: 0, Key: ''} }
    getFile(id) { return this.files[id] }

    getAllEntries() {
        return [...Object.values(this.folders), ...Object.values(this.files)]
    }
    // get all files and folders within a prefix
    getAll(entryId) {
        if (entryId == 0) return this.getAllEntries()
        if (!this.isFolder(entryId)) throw new Error(`provided id ${entryId} is not a folder`)
        return this.getAllEntries().filter(data => data.Key.startsWith(this.folders[entryId].Key + '/'))
    }
    
    // immediate children, both files and folders
    getChildren(entryId) {
        const folderDepth = entryId ? this.folders[entryId].Key.split('/').length : 0
        return this.getAll(entryId).filter(({Key}) => Key.split('/').length == folderDepth + 1)
    }
    getRecentlyAdded(prefix, pastDate) {
        return this.getAll(prefix).filter(({dateAdded}) => dateAdded && dateAdded > getDate(pastDate))
    }
    
    search(entryId, queryTerms) {
        if (!queryTerms.length) return []
        const regexp = new RegExp(queryTerms.map(q => escapeRegExp(q)).join('|'))
        return this.getAll(entryId).filter(({name}) => regexp.test(name))
    }
    async readStream(key) {
        return this.s3Hander.readFile(key)
    }
}