package com.faces

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import com.facebook.react.bridge.*
import java.io.ByteArrayOutputStream

class ImageCropModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "ImageCropModule"

    @ReactMethod
    fun cropFace(base64: String, left: Int, top: Int, width: Int, height: Int, promise: Promise) {
        try {
            val decodedBytes = Base64.decode(base64, Base64.DEFAULT)
            val options = BitmapFactory.Options().apply {
                inPreferredConfig = Bitmap.Config.ARGB_8888
            }
            val bitmap = BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size, options)
                ?: throw Exception("Failed to decode bitmap")

            // Ensure crop area is within bounds
            val safeLeft = left.coerceIn(0, bitmap.width - 1)
            val safeTop = top.coerceIn(0, bitmap.height - 1)
            val safeWidth = width.coerceIn(1, bitmap.width - safeLeft)
            val safeHeight = height.coerceIn(1, bitmap.height - safeTop)

            val croppedBitmap = Bitmap.createBitmap(
                bitmap,
                safeLeft,
                safeTop,
                safeWidth,
                safeHeight
            )

            val outputStream = ByteArrayOutputStream()
            croppedBitmap.compress(Bitmap.CompressFormat.JPEG, 90, outputStream)
            promise.resolve(Base64.encodeToString(outputStream.toByteArray(), Base64.NO_WRAP))
        } catch (e: Exception) {
            promise.reject("CROP_ERROR", e)
        }
    }
}