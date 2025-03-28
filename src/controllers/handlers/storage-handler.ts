import { HandlerContextWithPath } from '../../types'
import * as path from 'path'
import * as fs from 'fs'

export async function storageHandler(
  context: HandlerContextWithPath<'config' | 'logs' | 'metrics' | 'fetch' | 'server' | 'statusChecks', '/storage/:filename'>
) {
  const { filename } = context.params
  const storagePath = path.join(process.cwd(), 'storage', filename)
  
  if (!fs.existsSync(storagePath)) {
    return {
      status: 404,
      body: { error: 'File not found' }
    }
  }

  const stat = fs.statSync(storagePath)
  const stream = fs.createReadStream(storagePath)
  
  return {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size.toString(),
      'Cache-Control': 'public, max-age=31536000'
    },
    body: stream
  }
} 