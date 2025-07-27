package com.faces

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.*
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream

class FaceCropModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "FaceCropModule"

    @ReactMethod
    fun cropImage(imagePath: String, left: Int, top: Int, width: Int, height: Int, format: String, quality: Int, promise: Promise) {
        try {
            val file = File(imagePath)
            if (!file.exists()) {
                promise.reject("FILE_NOT_FOUND", "Image not found: $imagePath")
                return
            }

            // Decode image dengan options untuk menghindari OOM
            val options = BitmapFactory.Options()
            val original = BitmapFactory.decodeFile(imagePath, options)
            
            if (original == null) {
                promise.reject("DECODE_ERROR", "Failed to decode image: $imagePath")
                return
            }

            Log.d("FaceCrop", "Original bitmap: path=$imagePath, width=${original.width}, height=${original.height}")
            Log.d("FaceCrop", "Crop params: left=$left, top=$top, width=$width, height=$height")

            // Validasi dan normalisasi koordinat crop
            val imageWidth = original.width
            val imageHeight = original.height

            // Pastikan koordinat tidak negatif dan tidak melebihi batas gambar
            val safeLeft = left.coerceIn(0, imageWidth - 1)
            val safeTop = top.coerceIn(0, imageHeight - 1)
            
            // Pastikan width dan height tidak melebihi batas gambar
            val maxWidth = imageWidth - safeLeft
            val maxHeight = imageHeight - safeTop
            
            val safeWidth = width.coerceIn(1, maxWidth)
            val safeHeight = height.coerceIn(1, maxHeight)

            Log.d("FaceCrop", "Safe crop params: left=$safeLeft, top=$safeTop, width=$safeWidth, height=$safeHeight")

            // Validate final crop area
            if (safeLeft + safeWidth > imageWidth || safeTop + safeHeight > imageHeight) {
                Log.e("FaceCrop", "Crop area exceeds image bounds!")
                promise.reject("CROP_BOUNDS_ERROR", "Crop area exceeds image bounds")
                return
            }

            // Perform the crop
            val cropped = Bitmap.createBitmap(original, safeLeft, safeTop, safeWidth, safeHeight)
            
            if (cropped == null) {
                promise.reject("CROP_ERROR", "Failed to create cropped bitmap")
                return
            }

            Log.d("FaceCrop", "Cropped bitmap: width=${cropped.width}, height=${cropped.height}")

            // Determine output format
            val outputFormat = when (format.uppercase()) {
                "PNG" -> Bitmap.CompressFormat.PNG
                "WEBP" -> Bitmap.CompressFormat.WEBP
                else -> Bitmap.CompressFormat.JPEG
            }

            // Convert to base64
            val baos = ByteArrayOutputStream()
            val finalQuality = when (outputFormat) {
                Bitmap.CompressFormat.PNG -> 100 // PNG doesn't use quality, but set to 100
                else -> quality.coerceIn(10, 100)
            }
            
            cropped.compress(outputFormat, finalQuality, baos)
            val imageBytes = baos.toByteArray()
            val base64 = Base64.encodeToString(imageBytes, Base64.NO_WRAP)
            
            Log.d("FaceCrop", "Base64 result: format=$format, quality=$finalQuality, length=${base64.length}, bytes=${imageBytes.size}")

            // Cleanup
            if (cropped != original) {
                cropped.recycle()
            }
            original.recycle()
            baos.close()

            promise.resolve(base64)
            
        } catch (e: OutOfMemoryError) {
            Log.e("FaceCrop", "OOM_ERROR: ${e.message}")
            promise.reject("OOM_ERROR", "Out of Memory: ${e.message}", e)
        } catch (e: Exception) {
            Log.e("FaceCrop", "CROP_ERROR: ${e.message}")
            promise.reject("CROP_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun rotateImageIfNeeded(imagePath: String, promise: Promise) {
        try {
            val file = File(imagePath)
            if (!file.exists()) {
                promise.reject("FILE_NOT_FOUND", "Image not found: $imagePath")
                return
            }

            // Read EXIF data
            val exif = ExifInterface(file.absolutePath)
            val orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            
            val rotation = when (orientation) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }

            Log.d("FaceCrop", "EXIF orientation: $orientation, rotation needed: ${rotation}°")

            // If no rotation needed, return original path
            if (rotation == 0f) {
                promise.resolve(imagePath)
                return
            }

            // Decode original image
            val options = BitmapFactory.Options()
            options.inSampleSize = 1 // Full resolution untuk rotasi
            val original = BitmapFactory.decodeFile(imagePath, options)
            
            if (original == null) {
                Log.e("FaceCrop", "Failed to decode image for rotation")
                promise.resolve(imagePath) // Return original if can't decode
                return
            }

            Log.d("FaceCrop", "Before rotation: ${original.width}x${original.height}")

            // Create rotation matrix
            val matrix = Matrix()
            matrix.postRotate(rotation)

            // Create rotated bitmap
            val rotated = Bitmap.createBitmap(original, 0, 0, original.width, original.height, matrix, true)
            
            if (rotated == null) {
                Log.e("FaceCrop", "Failed to create rotated bitmap")
                original.recycle()
                promise.resolve(imagePath)
                return
            }

            Log.d("FaceCrop", "After rotation: ${rotated.width}x${rotated.height}")

            // Save rotated image
            val rotatedFile = File(reactContext.cacheDir, "rotated_${System.currentTimeMillis()}.jpg")
            val fos = FileOutputStream(rotatedFile)
            
            // Use high quality for rotation
            rotated.compress(Bitmap.CompressFormat.JPEG, 98, fos)
            fos.flush()
            fos.close()

            // Reset EXIF orientation to normal
            try {
                val exifRotated = ExifInterface(rotatedFile.absolutePath)
                exifRotated.setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL.toString())
                exifRotated.saveAttributes()
                Log.d("FaceCrop", "EXIF orientation reset to NORMAL")
            } catch (e: Exception) {
                Log.w("FaceCrop", "Failed to reset EXIF orientation: ${e.message}")
            }

            // Cleanup
            original.recycle()
            if (rotated != original) {
                rotated.recycle()
            }

            Log.d("FaceCrop", "Rotated image saved: ${rotatedFile.absolutePath}")
            promise.resolve(rotatedFile.absolutePath)

        } catch (e: OutOfMemoryError) {
            Log.e("FaceCrop", "OOM_ERROR during rotation: ${e.message}")
            promise.reject("OOM_ERROR", "Out of Memory during rotation: ${e.message}", e)
        } catch (e: Exception) {
            Log.e("FaceCrop", "ROTATE_ERROR: ${e.message}")
            promise.reject("ROTATE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getImageDimensions(imagePath: String, promise: Promise) {
        try {
            val file = File(imagePath)
            if (!file.exists()) {
                promise.reject("FILE_NOT_FOUND", "Image not found: $imagePath")
                return
            }

            val options = BitmapFactory.Options()
            options.inJustDecodeBounds = true
            BitmapFactory.decodeFile(imagePath, options)

            val result = Arguments.createMap()
            result.putInt("width", options.outWidth)
            result.putInt("height", options.outHeight)
            
            Log.d("FaceCrop", "Image dimensions: ${options.outWidth}x${options.outHeight}")
            promise.resolve(result)

        } catch (e: Exception) {
            Log.e("FaceCrop", "GET_DIMENSIONS_ERROR: ${e.message}")
            promise.reject("GET_DIMENSIONS_ERROR", e.message, e)
        }
    }
}