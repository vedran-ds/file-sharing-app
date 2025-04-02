const express = require('express');
const multer = require('multer');
const AWS = require('aws-sdk');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

const s3 = new AWS.S3();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Upload endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const folder = process.env.S3_FOLDER || 'uploads';
    const fileId = uuidv4();
    const fileName = `${folder}/${fileId}-${req.file.originalname}`;

    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: fileName,
      Body: req.file.buffer,
      ContentType: req.file.mimetype
    };

    const uploadResult = await s3.upload(params).promise();
    
    // Create URL for accessing the file
    let fileUrl;
    
    // Check if permanent URLs are enabled
    if (process.env.USE_PERMANENT_URLS === 'true') {
      try {
        // Try to set the object to be publicly accessible using ACL
        // This will only work if ACLs are enabled on the bucket
        await s3.putObjectAcl({
          Bucket: process.env.S3_BUCKET_NAME,
          Key: fileName,
          ACL: 'public-read'
        }).promise();
      } catch (error) {
        // If ACLs are not supported, rely on bucket policy instead
        console.log('ACLs not supported on this bucket, using bucket policy for public access');
      }
      
      // Generate a permanent URL
      fileUrl = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
    } else {
      // Generate a pre-signed URL that expires in 24 hours (86400 seconds)
      fileUrl = s3.getSignedUrl('getObject', {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: fileName,
        Expires: 86400
      });
    }

    res.json({
      message: 'File uploaded successfully',
      fileUrl: fileUrl,
      fileId: fileId,
      isPermanent: process.env.USE_PERMANENT_URLS === 'true'
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Get share link endpoint
app.get('/share/:fileId', async (req, res) => {
  try {
    const folder = process.env.S3_FOLDER || 'uploads';
    const fileId = req.params.fileId;
    
    // List objects in the folder with the fileId prefix
    const listParams = {
      Bucket: process.env.S3_BUCKET_NAME,
      Prefix: `${folder}/${fileId}`
    };
    
    const listedObjects = await s3.listObjectsV2(listParams).promise();
    
    if (listedObjects.Contents.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const fileName = listedObjects.Contents[0].Key;
    
    let fileUrl;
    
    // Check if permanent URLs are enabled
    if (process.env.USE_PERMANENT_URLS === 'true') {
      // Generate a permanent URL
      fileUrl = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
    } else {
      // Generate a pre-signed URL that expires in 24 hours
      fileUrl = s3.getSignedUrl('getObject', {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: fileName,
        Expires: 86400
      });
    }
    
    res.json({
      fileUrl: fileUrl,
      isPermanent: process.env.USE_PERMANENT_URLS === 'true'
    });
  } catch (error) {
    console.error('Error generating share link:', error);
    res.status(500).json({ error: 'Failed to generate share link' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});