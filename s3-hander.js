import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, 
    HeadObjectCommand, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import {accessKeyId, secretAccessKey} from './passwords.js'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export function parseFileName(fileName) {
    // name[desc]{entryId}.type - [desc] is optional, {entryId} will have to filled to be the next available id
    const res = /^(.+?)(?:\[(.*)\])?(?:\{(\d+)\})?(?:\.(\w+))?$/.exec(fileName);
    if (!res) console.error(`File name ${fileName} can not be parsed`);
    return {name: res[1].trim(), desc: res[2] || '', id: res[3] || 0, type: res[4] || 'coll'};
}

export class S3Handler {
    constructor(rootPrefix) {
        this.bucketName = 'tipitaka'
        this.rootPrefix = rootPrefix
        this.s3 = new S3Client({
            endpoint: 'https://sgp1.digitaloceanspaces.com',
            region: 'unused', // it needs a non empty value
            credentials: { accessKeyId, secretAccessKey },
        })
    }
    addRoot(prefix) { return this.rootPrefix + '/' + prefix }
    removeRoot(prefix) { return prefix.replace(this.rootPrefix + '/', '') }

    async list(prefix, getAll = false) {
        const params = { Bucket: this.bucketName, Prefix: this.addRoot(prefix) }
        if (!getAll) params.Delimiter = '/' // not get subfolder content

        let allContent = [], ContinuationToken = null // needed when there are more than 1000 objects
        do {
            let { Contents, NextContinuationToken } = 
                await this.s3.send(new ListObjectsV2Command({...params, ContinuationToken}))
            allContent.push(...Contents)
            ContinuationToken = NextContinuationToken
            console.log(`contents length = ${Contents.length}. continuation ${ContinuationToken}`)
        } while (ContinuationToken)

        // ignore any folder entries and remove root from the key
        return allContent.filter(e => !e.Key.endsWith('/'))
            .map(e => {
                const Key = this.removeRoot(e.Key)
                const fileName = Key.split('/').slice(-1)[0], prefix = Key.split('/').slice(0, -1).join('/')
                return {...e, Key, ...parseFileName(fileName), fileName, prefix}
            }).filter(({id}) => id) // entries without ids ignored
    }
      
    async readFile(key) {
        const command = new GetObjectCommand({
            Bucket: this.bucketName,
            Key: this.addRoot(key)
        })
        const { Body } = await this.s3.send(command)
        return Body
    }

    async exists(key) {
        const headObjectCommand = new HeadObjectCommand({
            Bucket: this.bucketName,
            Key: this.addRoot(key)
        })
          
        try {
            await this.s3.send(headObjectCommand)
            return true
        } catch(err) {
            return false
        }
    }
    
    async rename(oldKey, newKey) { // not used
        console.log(`rename from ${oldKey} to ${newKey}`)
        const copyParams = {
            Bucket: this.bucketName,
            CopySource: this.bucketName + '/' + this.addRoot(oldKey),
            Key: this.addRoot(newKey),
        }
        const deleteParams = {
            Bucket: this.bucketName,
            Key: this.addRoot(oldKey),
        };
        await this.s3.send(new CopyObjectCommand(copyParams));
        await this.s3.send(new DeleteObjectCommand(deleteParams));
    }

    async upload(uploadParams) {
        uploadParams.Key = this.addRoot(uploadParams.Key)
        uploadParams.Bucket = this.bucketName
        await this.s3.send(new PutObjectCommand(uploadParams));
    }

    async getSignedUrl(key, expiresIn) {
        const command = new GetObjectCommand({ Bucket: this.bucketName, Key: this.addRoot(key) });
        return getSignedUrl(this.s3, command, { expiresIn });
    }

    // public url https://tipitaka.sgp1.digitaloceanspaces.com/Key
    async recomputeThumbnails(id, Key) {
        const options = {
            density: 100,
            format: "jpg",
            quality: 40,
        }

        try {
            const command = new GetObjectCommand({
                Bucket: this.bucketName,
                Key: this.addRoot(Key)
            })
            const {Body} = await this.s3.send(command);
            //const url = await getSignedUrl(this.s3, command, { expiresIn: 60 });
            const pdfBuffer = await new Promise((resolve, reject) => {
                const chunks = [];
                Body.on("data", (chunk) => chunks.push(chunk));
                Body.on("error", reject);
                Body.on("end", () => resolve(Buffer.concat(chunks)));
            });
             // load the PDF file using pdfjs
            const loadingTask = pdfjsLib.getDocument({data:new Uint8Array(pdfBuffer.buffer)});

            // wait for the PDF file to load
            const pdf = await loadingTask.promise;

            // get the number of pages
            const numPages = pdf.numPages;

            // get the resolution of the first page
            const page = await pdf.getPage(1);
            const { width, height } = page.getViewport({ scale: 1 });
            const resolution = `${width}x${height}`;

            console.log(`Number of pages: ${numPages}`);
            console.log(`Resolution of first page: ${resolution}`);
        } catch(e) { console.log(e.stack)}


        // Upload images to S3
        // await Promise.all(
        //     images.map(async (imageData, index) => {
        //         const putObjectParams = {
        //             Bucket: this.bucketName,
        //             Key: this.addRoot(`thumbs/${id}-${index}.jpg`),
        //             Body: imageData,
        //             ACL: "public-read",
        //         };
        //         await this.s3.send(new PutObjectCommand(putObjectParams));
        //     })
        // );
        console.log("Images saved successfully.")
    }
}

// const sh = new S3Handler('library-dev')
// sh.list('').then(l => l.forEach(f => console.log(f)))
// sh.exists('test/hal-tool.html').then(r => console.log(r))
// sh.readFile('test/test/hal-tool.html').then(s => console.log(s))