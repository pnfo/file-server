import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, 
    HeadObjectCommand, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import {accessKeyId, secretAccessKey} from './passwords.js'
//import {pdf2pic} from 'pdf2pic'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

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

        return allContent.slice(1).map(e => ({...e, Key: this.removeRoot(e.Key)}))
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

    async recomputeThumbnails(Key) {
        const s3 = new S3Client({ region: "your-region" });

        const converter = new pdf2pic({
            density: 100,
            savename: "untitled",
            savedir: "/tmp",
            format: "jpeg",
            size: {
                height: 1000,
            },
            quality: 40,
        });

        const {Body: pdfBuffer} = await s3.send(new GetObjectCommand({
            Bucket: this.bucketName,
            Key: this.addRoot(Key)
        }));

        // Convert PDF to images
        const { data: images } = await converter.convert(pdfBuffer, [1, Math.ceil(converter.numberOfPages / 2)]);

        // Upload images to S3
        await Promise.all(
            images.map(async (imageData, index) => {
                const putObjectParams = {
                    Bucket: this.bucketName,
                    Key: this.addRoot(`thumbs/${outputPrefix}-${index}.jpg`),
                    Body: imageData,
                    ACL: "public-read",
                };
                await s3.send(new PutObjectCommand(putObjectParams));
            })
        );
        console.log("Images saved successfully.");

        processPdf();

    }
}

// const sh = new S3Handler('library-dev')
// sh.list('').then(l => l.forEach(f => console.log(f)))
// sh.exists('test/hal-tool.html').then(r => console.log(r))
// sh.readFile('test/test/hal-tool.html').then(s => console.log(s))