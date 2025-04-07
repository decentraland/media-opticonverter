import { HandlerContextWithPath } from '../../types'
import { MediaConverter } from '../../adapters/media-converter'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
} as const

export async function convertHandler(
  context: HandlerContextWithPath<'config' | 'logs' | 'metrics' | 'fetch' | 'server' | 'statusChecks', '/convert'>
) {
  const { components, request } = context

  let fileUrl: string | undefined
  let ktx2: boolean | undefined
  let preProcessToPNG: boolean | undefined

  if (request.method === 'GET') {
    const url = new URL(request.url)
    fileUrl = url.searchParams.get('fileUrl') || undefined
    ktx2 = url.searchParams.get('ktx2') === 'true'
    preProcessToPNG = url.searchParams.get('preProcessToPNG') === 'true'
  } else {
    const body = await request.json()
    fileUrl = body.fileUrl
    ktx2 = body.ktx2
    preProcessToPNG = body.preProcessToPNG
  }

  if (!fileUrl) {
    return {
      status: 400,
      headers: corsHeaders,
      body: { error: 'fileUrl is required' }
    }
  }

  try {
    const useLocalStorage = (await components.config.getString('USE_LOCAL_STORAGE')) === 'true'

    let bucket = ''
    let cloudfrontDomain = ''
    let region = ''

    if (!useLocalStorage) {
      bucket = await components.config.requireString('S3_BUCKET')
      cloudfrontDomain = await components.config.requireString('CLOUDFRONT_DOMAIN')
      region = await components.config.requireString('AWS_REGION')
    }

    const converter = MediaConverter.getInstance(bucket, cloudfrontDomain, region, components, useLocalStorage)
    const result = await converter.convert(fileUrl, ktx2, preProcessToPNG)

    if (request.method === 'GET') {
      return {
        status: 302,
        headers: {
          ...corsHeaders,
          Location: result,
          'Cache-Control': 'public, max-age=31536000'
        }
      }
    }

    return {
      status: 200,
      headers: {
        ...corsHeaders,
        'Cache-Control': 'public, max-age=31536000'
      },
      body: { url: result }
    }
  } catch (error) {
    console.error('Error processing request:', error)
    if (error instanceof Error && error.message.includes('Processing hash already exists')) {
      return {
        status: 429,
        headers: {
          ...corsHeaders,
          'Retry-After': '30', // 5 seconds
          'Cache-Control': 'no-cache'
        },
        body: { 
          error: error.message,
          retryAfter: 5
        }
      }
    }
    return {
      status: 500,
      headers: corsHeaders,
      body: { error: error instanceof Error ? error.message : 'Internal server error' }
    }
  }
}
