package com.faces

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.util.Base64
import com.facebook.react.bridge.*
import java.io.ByteArrayOutputStream

class ImageRotateModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "ImageRotateModule"

    @ReactMethod
    fun rotateBase64Image(base64: String, degrees: Int, promise: Promise) {
        try {
            val decodedBytes = Base64.decode(base64, Base64.DEFAULT)
            val options = BitmapFactory.Options().apply {
                inPreferredConfig = Bitmap.Config.ARGB_8888
                inMutable = true
            }
            val bitmap = BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size, options)
                ?: throw Exception("Failed to decode bitmap")

            val matrix = Matrix().apply {
                postRotate(degrees.toFloat())
            }

            val rotatedBitmap = Bitmap.createBitmap(
                bitmap,
                0,
                0,
                bitmap.width,
                bitmap.height,
                matrix,
                true
            )

            val outputStream = ByteArrayOutputStream()
            rotatedBitmap.compress(Bitmap.CompressFormat.JPEG, 85, outputStream)
            promise.resolve(Base64.encodeToString(outputStream.toByteArray(), Base64.NO_WRAP))
        } catch (e: Exception) {
            promise.reject("ROTATE_ERROR", e)
        }
    }
}