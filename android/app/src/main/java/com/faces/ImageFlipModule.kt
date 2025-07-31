package com.faces

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.util.Base64
import com.facebook.react.bridge.*

import java.io.ByteArrayOutputStream

class ImageFlipModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String {
        return "ImageFlipModule"
    }

    @ReactMethod
    fun flipBase64Image(base64: String, direction: String, promise: Promise) {
        try {
            val decodedBytes = Base64.decode(base64, Base64.DEFAULT)
            val original = BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size)

            if (original == null) {
                promise.reject("DECODE_ERROR", "Failed to decode base64 image")
                return
            }

            val matrix = Matrix()
            when (direction) {
                "horizontal" -> matrix.preScale(-1f, 1f)
                "vertical" -> matrix.preScale(1f, -1f)
                else -> matrix.preScale(1f, 1f) // no flip
            }

            val flipped = Bitmap.createBitmap(original, 0, 0, original.width, original.height, matrix, true)

            val outputStream = ByteArrayOutputStream()
            flipped.compress(Bitmap.CompressFormat.JPEG, 90, outputStream)
            val flippedBytes = outputStream.toByteArray()

            val flippedBase64 = Base64.encodeToString(flippedBytes, Base64.NO_WRAP)
            promise.resolve(flippedBase64)
        } catch (e: Exception) {
            promise.reject("FLIP_ERROR", e)
        }
    }
}
