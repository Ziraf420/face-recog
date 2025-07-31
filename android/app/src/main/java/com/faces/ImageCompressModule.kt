package com.faces

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.util.Base64
import com.facebook.react.bridge.*
import java.io.ByteArrayOutputStream
import kotlin.math.min
import kotlin.math.sqrt

class ImageCompressModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "ImageCompressModule"
    }

    @ReactMethod
    fun compressBase64Image(
        base64String: String,
        maxWidth: Int,
        maxHeight: Int,
        quality: Int,
        promise: Promise
    ) {
        try {
            val startTime = System.currentTimeMillis()
            
            // Decode base64 to bitmap
            val decodedBytes = Base64.decode(base64String, Base64.DEFAULT)
            val originalBitmap = BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size)
            
            if (originalBitmap == null) {
                promise.reject("DECODE_ERROR", "Failed to decode base64 image")
                return
            }

            // Calculate optimal size
            val scaleFactor = calculateScaleFactor(
                originalBitmap.width, 
                originalBitmap.height, 
                maxWidth, 
                maxHeight
            )
            
            val newWidth = (originalBitmap.width * scaleFactor).toInt()
            val newHeight = (originalBitmap.height * scaleFactor).toInt()

            // Resize bitmap efficiently
            val resizedBitmap = Bitmap.createScaledBitmap(originalBitmap, newWidth, newHeight, true)
            
            // Compress to JPEG
            val outputStream = ByteArrayOutputStream()
            resizedBitmap.compress(Bitmap.CompressFormat.JPEG, quality, outputStream)
            
            // Convert back to base64
            val compressedBytes = outputStream.toByteArray()
            val compressedBase64 = Base64.encodeToString(compressedBytes, Base64.NO_WRAP)
            
            // Cleanup
            originalBitmap.recycle()
            resizedBitmap.recycle()
            outputStream.close()
            
            val processingTime = System.currentTimeMillis() - startTime
            
            // Return result with metrics
            val result = Arguments.createMap().apply {
                putString("base64", compressedBase64)
                putInt("originalSize", decodedBytes.size)
                putInt("compressedSize", compressedBytes.size)
                putDouble("compressionRatio", decodedBytes.size.toDouble() / compressedBytes.size)
                putInt("processingTime", processingTime.toInt())
                putInt("width", newWidth)
                putInt("height", newHeight)
            }
            
            promise.resolve(result)
            
        } catch (e: Exception) {
            promise.reject("COMPRESSION_ERROR", "Failed to compress image: ${e.message}")
        }
    }

    @ReactMethod
    fun smartCompress(
        base64String: String,
        targetSizeKB: Int,
        promise: Promise
    ) {
        try {
            val startTime = System.currentTimeMillis()
            
            val decodedBytes = Base64.decode(base64String, Base64.DEFAULT)
            var currentBitmap = BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size)
            
            if (currentBitmap == null) {
                promise.reject("DECODE_ERROR", "Failed to decode base64 image")
                return
            }

            var quality = 90
            var currentSize = decodedBytes.size / 1024 // KB
            val targetSize = targetSizeKB
            
            var compressedBase64 = ""
            
            // Smart compression algorithm
            while (currentSize > targetSize && quality > 10) {
                val outputStream = ByteArrayOutputStream()
                
                // Calculate scale factor if needed
                if (currentSize > targetSize * 2) {
                    val scaleFactor = sqrt(targetSize.toDouble() / currentSize).toFloat()
                    val newWidth = (currentBitmap.width * scaleFactor).toInt()
                    val newHeight = (currentBitmap.height * scaleFactor).toInt()
                    
                    val scaledBitmap = Bitmap.createScaledBitmap(currentBitmap, newWidth, newHeight, true)
                    if (currentBitmap != scaledBitmap) {
                        currentBitmap.recycle()
                    }
                    currentBitmap = scaledBitmap
                }
                
                currentBitmap.compress(Bitmap.CompressFormat.JPEG, quality, outputStream)
                val compressedBytes = outputStream.toByteArray()
                currentSize = compressedBytes.size / 1024
                
                compressedBase64 = Base64.encodeToString(compressedBytes, Base64.NO_WRAP)
                outputStream.close()
                
                quality -= 10
            }
            
            currentBitmap.recycle()
            val processingTime = System.currentTimeMillis() - startTime
            
            val result = Arguments.createMap().apply {
                putString("base64", compressedBase64)
                putInt("originalSize", decodedBytes.size)
                putInt("finalSize", currentSize * 1024)
                putInt("processingTime", processingTime.toInt())
                putInt("finalQuality", quality + 10)
                putBoolean("targetAchieved", currentSize <= targetSize)
            }
            
            promise.resolve(result)
            
        } catch (e: Exception) {
            promise.reject("SMART_COMPRESSION_ERROR", "Failed to smart compress: ${e.message}")
        }
    }

    @ReactMethod
    fun batchCompress(
        base64Array: ReadableArray,
        maxWidth: Int,
        quality: Int,
        promise: Promise
    ) {
        try {
            val results = Arguments.createArray()
            var totalTime = 0L
            
            for (i in 0 until base64Array.size()) {
                val startTime = System.currentTimeMillis()
                val base64 = base64Array.getString(i) ?: continue
                
                val decodedBytes = Base64.decode(base64, Base64.DEFAULT)
                val originalBitmap = BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size)
                
                if (originalBitmap != null) {
                    val scaleFactor = min(maxWidth.toFloat() / originalBitmap.width, 1f)
                    val newWidth = (originalBitmap.width * scaleFactor).toInt()
                    val newHeight = (originalBitmap.height * scaleFactor).toInt()
                    
                    val resizedBitmap = Bitmap.createScaledBitmap(originalBitmap, newWidth, newHeight, true)
                    
                    val outputStream = ByteArrayOutputStream()
                    resizedBitmap.compress(Bitmap.CompressFormat.JPEG, quality, outputStream)
                    
                    val compressedBase64 = Base64.encodeToString(outputStream.toByteArray(), Base64.NO_WRAP)
                    
                    val itemResult = Arguments.createMap().apply {
                        putInt("index", i)
                        putString("base64", compressedBase64)
                        putInt("originalSize", decodedBytes.size)
                        putInt("compressedSize", outputStream.size())
                    }
                    
                    results.pushMap(itemResult)
                    
                    originalBitmap.recycle()
                    resizedBitmap.recycle()
                    outputStream.close()
                }
                
                totalTime += System.currentTimeMillis() - startTime
            }
            
            val finalResult = Arguments.createMap().apply {
                putArray("results", results)
                putInt("totalProcessingTime", totalTime.toInt())
                putInt("averageTimePerImage", (totalTime / base64Array.size()).toInt())
            }
            
            promise.resolve(finalResult)
            
        } catch (e: Exception) {
            promise.reject("BATCH_COMPRESSION_ERROR", "Failed to batch compress: ${e.message}")
        }
    }

    private fun calculateScaleFactor(
        originalWidth: Int, 
        originalHeight: Int, 
        maxWidth: Int, 
        maxHeight: Int
    ): Float {
        val widthScale = maxWidth.toFloat() / originalWidth
        val heightScale = maxHeight.toFloat() / originalHeight
        return min(min(widthScale, heightScale), 1f)
    }
}