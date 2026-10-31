export function readQrScanRegion(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  scanBox: HTMLElement,
  maxDimension = 640,
) {
  if (video.readyState < video.HAVE_ENOUGH_DATA || !video.videoWidth || !video.videoHeight) return null

  const videoRect = video.getBoundingClientRect()
  const scanRect = scanBox.getBoundingClientRect()
  if (!videoRect.width || !videoRect.height || !scanRect.width || !scanRect.height) return null

  const coverScale = Math.max(videoRect.width / video.videoWidth, videoRect.height / video.videoHeight)
  const renderedWidth = video.videoWidth * coverScale
  const renderedHeight = video.videoHeight * coverScale
  const offsetX = (videoRect.width - renderedWidth) / 2
  const offsetY = (videoRect.height - renderedHeight) / 2
  const sourceLeft = (scanRect.left - videoRect.left - offsetX) / coverScale
  const sourceTop = (scanRect.top - videoRect.top - offsetY) / coverScale
  const sourceRight = sourceLeft + scanRect.width / coverScale
  const sourceBottom = sourceTop + scanRect.height / coverScale
  const left = Math.max(0, Math.floor(sourceLeft))
  const top = Math.max(0, Math.floor(sourceTop))
  const right = Math.min(video.videoWidth, Math.ceil(sourceRight))
  const bottom = Math.min(video.videoHeight, Math.ceil(sourceBottom))
  const sourceWidth = right - left
  const sourceHeight = bottom - top
  if (sourceWidth <= 0 || sourceHeight <= 0) return null

  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('تعذر تجهيز إطار قراءة الباركود.')
  context.drawImage(video, left, top, sourceWidth, sourceHeight, 0, 0, width, height)
  return context.getImageData(0, 0, width, height)
}
