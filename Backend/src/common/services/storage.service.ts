import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { randomUUID } from 'crypto';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: string;
  private readonly bucket: string;
  private readonly localRoot: string;
  private client?: Client;
  private minioReady = false;

  constructor(private readonly config: ConfigService) {
    this.driver = this.config.get<string>('STORAGE_DRIVER', 'local');
    this.bucket = this.config.get<string>('MINIO_BUCKET', 'hnb-private');
    this.localRoot = resolve(process.cwd(), 'uploads');
    if (this.driver === 'minio') {
      this.client = new Client({
        endPoint: this.config.get<string>('MINIO_ENDPOINT', 'localhost'),
        port: Number(this.config.get<string>('MINIO_PORT', '9000')),
        useSSL: this.config.get<string>('MINIO_USE_SSL', 'false') === 'true',
        accessKey: this.config.get<string>('MINIO_ACCESS_KEY', ''),
        secretKey: this.config.get<string>('MINIO_SECRET_KEY', ''),
      });
    }
  }

  async onModuleInit() {
    if (this.driver !== 'minio' || !this.client) return;
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) await this.client.makeBucket(this.bucket);
      this.minioReady = true;
    } catch (error) {
      if (this.config.get<string>('NODE_ENV') === 'production') {
        // Never silently keep private financial files on the application server's disk.
        throw new Error(`Object storage is unavailable: ${(error as Error).message}`);
      }
      this.logger.warn(
        `MinIO unavailable, falling back to local private storage: ${(error as Error).message}`,
      );
    }
  }

  async put(buffer: Buffer, filename: string, contentType: string): Promise<string> {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
    const key = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safe}`;
    if (this.minioReady && this.client) {
      await this.client.putObject(this.bucket, key, buffer, buffer.length, {
        'Content-Type': contentType,
      });
      return key;
    }
    await fs.mkdir(join(this.localRoot, key.split('/')[0]), { recursive: true });
    await fs.writeFile(join(this.localRoot, key), buffer);
    return key;
  }

  async get(key: string): Promise<Buffer> {
    if (this.minioReady && this.client) {
      const stream = await this.client.getObject(this.bucket, key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    }
    return fs.readFile(join(this.localRoot, key));
  }

  async signedUrl(key: string, expirySeconds = 300): Promise<string | null> {
    if (this.minioReady && this.client) {
      return this.client.presignedGetObject(this.bucket, key, expirySeconds);
    }
    return null;
  }
}
