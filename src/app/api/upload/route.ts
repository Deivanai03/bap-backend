import { NextRequest } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../lib/api/response';
import { handleOptions } from '../../../lib/api/cors';
import { apiRateLimit } from '../../../lib/rate-limit';
import { verifyAuthAndGetUser } from '../../../middleware/auth';
import { db } from '../../../lib/db';
import { file_uploads } from '../../../lib/db/schema';

/**
 * @swagger
 * /api/upload:
 *   post:
 *     summary: Upload files
 *     description: Upload one or more files to the server
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       200:
 *         description: Files uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         files:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id:
 *                                 type: string
 *                               type:
 *                                 type: string
 *                                 enum: [image, video, audio, document]
 *                               name:
 *                                 type: string
 *                               url:
 *                                 type: string
 *                               size:
 *                                 type: integer
 *                               mimeType:
 *                                 type: string
 *                         errors:
 *                           type: array
 *                           items:
 *                             type: string
 *       400:
 *         description: No files provided or invalid files
 */

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const ALLOWED_TYPES: Record<string, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
  video: ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'],
  audio: [
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'audio/webm',
    'audio/mp4',
    'audio/x-m4a',
    'audio/aac',
    'audio/flac',
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
  ],
  document: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'application/json',
    'application/zip',
    'application/x-zip-compressed',
    'application/x-rar-compressed',
    'application/vnd.rar',
  ],
};

function getFileType(mimeType: string): 'image' | 'video' | 'audio' | 'document' | null {
  // Normalize MIME type (remove codec info like ";codecs=opus")
  const baseMimeType = mimeType.split(';')[0].trim().toLowerCase();

  for (const [type, mimes] of Object.entries(ALLOWED_TYPES)) {
    // Check exact match or base match
    if (mimes.some(m => m === mimeType || m === baseMimeType || m.split(';')[0] === baseMimeType)) {
      return type as 'image' | 'video' | 'audio' | 'document';
    }
  }
  return null;
}

export async function OPTIONS() {
  return handleOptions();
}

export async function POST(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (!rateLimitResult.success) {
    return createErrorResponse('Rate limit exceeded', 429);
  }

  const authResult = await verifyAuthAndGetUser(request);
  if (!authResult.success) {
    return createErrorResponse(authResult.error!, 401, ApiErrorCode.INVALID_SESSION);
  }

  const { user } = authResult;

  try {
    // Ensure upload directory exists
    if (!existsSync(UPLOAD_DIR)) {
      await mkdir(UPLOAD_DIR, { recursive: true });
    }

    const formData = await request.formData();
    const files = formData.getAll('files') as File[];

    if (!files || files.length === 0) {
      return createErrorResponse('No files provided', 400, ApiErrorCode.INVALID_INPUT);
    }

    const uploadedFiles: Array<{
      id: string;
      type: 'image' | 'video' | 'audio' | 'document';
      name: string;
      url: string;
      size: number;
      mimeType: string;
    }> = [];

    const errors: string[] = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: File too large (max 50MB)`);
        continue;
      }

      const fileType = getFileType(file.type);
      if (!fileType) {
        errors.push(`${file.name}: File type not allowed`);
        continue;
      }

      try {
        const fileId = uuidv4();
        const extension = path.extname(file.name).toLowerCase() || '.bin';
        const filename = `${fileId}${extension}`;
        const filepath = path.join(UPLOAD_DIR, filename);

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        await writeFile(filepath, buffer);

        // Save to database
        await db.insert(file_uploads).values({
          id: fileId,
          org_id: user.org_id,
          user_id: user.user_id,
          filename,
          original_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          file_path: filepath,
          upload_status: 'completed'
        });

        // Construct full URL for the uploaded file
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || 'http://localhost:3001';
        const fileUrl = `${baseUrl}/uploads/${filename}`;

        uploadedFiles.push({
          id: fileId,
          type: fileType,
          name: file.name,
          url: fileUrl,
          size: file.size,
          mimeType: file.type,
        });
      } catch (fileError) {
        console.error(`Error uploading ${file.name}:`, fileError);
        errors.push(`${file.name}: Upload failed`);
      }
    }

    if (uploadedFiles.length === 0) {
      return createErrorResponse('No files were uploaded', 400, ApiErrorCode.INVALID_INPUT);
    }

    return createApiResponse({
      files: uploadedFiles,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Error uploading files:', error);
    return createErrorResponse('Failed to upload files', 500, ApiErrorCode.INTERNAL_ERROR);
  }
}
