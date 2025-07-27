import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Image, Modal, TouchableOpacity, Dimensions, StatusBar, Platform,
} from 'react-native';
import { Camera, useCameraDevices } from 'react-native-vision-camera';
import FaceDetection, { Face, FaceDetectionOptions } from '@react-native-ml-kit/face-detection';
import { NativeModules } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

const { FaceCropModule } = NativeModules;
const BOUNDING_BOX_PADDING = 20; // Increased padding

type ImageInfo = { path: string, width: number, height: number };

export default function App() {
  const [hasPermission, setHasPermission] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [faceCount, setFaceCount] = useState(0);
  const [croppedFaces, setCroppedFaces] = useState<string[]>([]);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [detectedFaces, setDetectedFaces] = useState<Face[]>([]);
  const [actualImageWidth, setActualImageWidth] = useState(0);
  const [actualImageHeight, setActualImageHeight] = useState(0);
  const [imageDisplayDimensions, setImageDisplayDimensions] = useState({ width: 0, height: 0, x: 0, y: 0 });
  
  // Image format options
  const [outputFormat, setOutputFormat] = useState<'JPEG' | 'PNG' | 'WEBP'>('JPEG');
  const [imageQuality, setImageQuality] = useState(95);

  // State untuk kontrol auto-detection
  const [shouldAutoDetect, setShouldAutoDetect] = useState(true);
  const [lastDetectedImage, setLastDetectedImage] = useState<ImageInfo | null>(null);
  const [lastBoundingBoxes, setLastBoundingBoxes] = useState<Face[]>([]);
  const [cropTriggered, setCropTriggered] = useState(false);

  const cameraRef = useRef<Camera>(null);
  const devices = useCameraDevices();
  const device = devices.find((d) => d.position === 'front') ?? devices.find((d) => d.position === 'back');

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
    })();
  }, []);

  // Fungsi untuk menghitung dimensi display yang akurat
  const calculateImageDisplayDimensions = (imgWidth: number, imgHeight: number) => {
    const screenW = Dimensions.get('window').width;
    const screenH = Dimensions.get('window').height - (Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0);
    
    const imageRatio = imgWidth / imgHeight;
    const screenRatio = screenW / screenH;

    let displayWidth, displayHeight, offsetX = 0, offsetY = 0;
    
    if (imageRatio > screenRatio) {
      // Image lebih lebar - fit to width
      displayWidth = screenW;
      displayHeight = screenW / imageRatio;
      offsetY = (screenH - displayHeight) / 2;
    } else {
      // Image lebih tinggi - fit to height
      displayHeight = screenH;
      displayWidth = screenH * imageRatio;
      offsetX = (screenW - displayWidth) / 2;
    }

    return { width: displayWidth, height: displayHeight, x: offsetX, y: offsetY };
  };

  // Deteksi wajah dengan kontrol yang lebih baik
  const detectFace = async () => {
    if (!cameraRef.current || isProcessing || !shouldAutoDetect) return;
    
    setIsProcessing(true);
    setShouldAutoDetect(false);
    
    try {
      console.log('[DEBUG] Starting face detection...');
      const photo = await cameraRef.current.takePhoto({ flash: 'off', enableShutterSound: false });
      
      let rotatedPath = photo.path;
      let rotatedWidth = photo.width;
      let rotatedHeight = photo.height;
      
      // Rotate image if needed dan dapatkan dimensi yang benar
      try {
        rotatedPath = await FaceCropModule.rotateImageIfNeeded(photo.path);
        
        // Wait untuk mendapatkan dimensi gambar yang sudah dirotate
        const imageSize = await new Promise<{width: number, height: number}>((resolve, reject) => {
          Image.getSize(
            `file://${rotatedPath}`,
            (width, height) => resolve({ width, height }),
            (error) => {
              console.warn('[WARN] Could not get rotated image size:', error);
              resolve({ width: rotatedWidth, height: rotatedHeight });
            }
          );
        });
        
        rotatedWidth = imageSize.width;
        rotatedHeight = imageSize.height;
        
      } catch (rotationError) {
        console.warn('[WARN] Image rotation failed:', rotationError);
        rotatedPath = photo.path;
      }

      console.log(`[DEBUG] Final image dimensions: ${rotatedWidth}x${rotatedHeight}`);

      // Set image info dengan dimensi yang benar
      setFullscreenImage(`file://${rotatedPath}`);
      setActualImageWidth(rotatedWidth);
      setActualImageHeight(rotatedHeight);
      
      // Calculate display dimensions
      const displayDims = calculateImageDisplayDimensions(rotatedWidth, rotatedHeight);
      setImageDisplayDimensions(displayDims);

      // Face detection
      const options: FaceDetectionOptions = {
        performanceMode: 'accurate',
        landmarkMode: 'none',
        contourMode: 'none',
        classificationMode: 'none',
        minFaceSize: 0.1,
      };
      
      const faces = await FaceDetection.detect(`file://${rotatedPath}`, options);
      console.log(`[DEBUG] Detected ${faces.length} faces`);
      
      setFaceCount(faces.length);
      setDetectedFaces(faces);

      // Store for cropping dengan informasi yang benar
      setLastDetectedImage({ path: rotatedPath, width: rotatedWidth, height: rotatedHeight });
      setLastBoundingBoxes(faces);
      setCropTriggered(false);
      
      // Show fullscreen
      setShowFullscreen(true);

      // Debug log yang lebih detail
      console.log('[DEBUG] Image info:', {
        path: rotatedPath,
        actualSize: `${rotatedWidth}x${rotatedHeight}`,
        displaySize: `${displayDims.width}x${displayDims.height}`,
        offset: `${displayDims.x},${displayDims.y}`
      });
      
      if (faces.length > 0) {
        faces.forEach((f, i) => {
          console.log(`[DEBUG] ML Kit Face[${i}]:`, {
            frame: f.frame,
            relative: {
              left: f.frame.left / rotatedWidth,
              top: f.frame.top / rotatedHeight,
              width: f.frame.width / rotatedWidth,
              height: f.frame.height / rotatedHeight
            }
          });
        });
      }
      
    } catch (err) {
      console.error('[ERROR] detectFace failed:', err);
      setShouldAutoDetect(true);
    } finally {
      setIsProcessing(false);
    }
  };

  // Auto-crop dengan koordinat yang diperbaiki
  useEffect(() => {
    if (
      showFullscreen &&
      lastDetectedImage &&
      lastBoundingBoxes.length > 0 &&
      !cropTriggered &&
      imageDisplayDimensions.width > 0
    ) {
      const timer = setTimeout(async () => {
        console.log('[DEBUG] Starting auto-crop...');
        const newCroppedFaces: string[] = [];
        
        for (const [idx, face] of lastBoundingBoxes.entries()) {
          try {
            // Gunakan koordinat asli dari ML Kit dengan validasi yang lebih ketat
            const originalLeft = Math.max(0, face.frame.left);
            const originalTop = Math.max(0, face.frame.top);
            const originalWidth = Math.min(face.frame.width, lastDetectedImage.width - originalLeft);
            const originalHeight = Math.min(face.frame.height, lastDetectedImage.height - originalTop);

            // Apply padding dengan bounds checking yang lebih baik
            const cropLeft = Math.max(0, Math.floor(originalLeft - BOUNDING_BOX_PADDING));
            const cropTop = Math.max(0, Math.floor(originalTop - BOUNDING_BOX_PADDING));
            
            const maxCropWidth = lastDetectedImage.width - cropLeft;
            const maxCropHeight = lastDetectedImage.height - cropTop;
            
            const cropWidth = Math.min(
              maxCropWidth,
              Math.floor(originalWidth + (BOUNDING_BOX_PADDING * 2))
            );
            const cropHeight = Math.min(
              maxCropHeight,
              Math.floor(originalHeight + (BOUNDING_BOX_PADDING * 2))
            );

            // Validasi final
            if (cropWidth <= 0 || cropHeight <= 0) {
              console.warn(`[WARN] Invalid crop dimensions for face ${idx}`);
              continue;
            }

            console.log(`[DEBUG] Cropping Face[${idx}]:`, {
              mlKit: { 
                left: face.frame.left, 
                top: face.frame.top, 
                width: face.frame.width, 
                height: face.frame.height 
              },
              normalized: { left: originalLeft, top: originalTop, width: originalWidth, height: originalHeight },
              crop: { left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight },
              imageSize: { w: lastDetectedImage.width, h: lastDetectedImage.height },
              imageActual: { w: actualImageWidth, h: actualImageHeight },
              format: outputFormat,
              quality: imageQuality
            });
            
            const base64 = await FaceCropModule.cropImage(
              lastDetectedImage.path, 
              cropLeft, 
              cropTop, 
              cropWidth, 
              cropHeight,
              outputFormat,
              imageQuality
            );
            
            if (base64 && base64.length > 100) {
              newCroppedFaces.push(base64);
              console.log(`[DEBUG] Successfully cropped face ${idx}, format: ${outputFormat}, base64 length: ${base64}`);
            } else {
              console.warn(`[WARN] Invalid base64 for face ${idx}, length: ${base64?.length || 0}`);
            }
          } catch (err) {
            console.error(`[ERROR] Cropping face ${idx} failed:`, err);
          }
        }
        
        if (newCroppedFaces.length > 0) {
          setCroppedFaces((prev) => {
            const combined = [...newCroppedFaces, ...prev];
            return combined.slice(0, 10);
          });
          console.log(`[DEBUG] Added ${newCroppedFaces.length} cropped faces`);
        } else {
          console.warn('[WARN] No faces were successfully cropped');
        }
        
        setCropTriggered(true);
      }, 1500); // Increased delay

      return () => clearTimeout(timer);
    }
  }, [showFullscreen, lastDetectedImage, lastBoundingBoxes, cropTriggered, imageDisplayDimensions, actualImageWidth, actualImageHeight]);

  // Close fullscreen dan kembali ke kamera
  const closeFullscreen = () => {
    console.log('[DEBUG] Closing fullscreen...');
    setShowFullscreen(false);
    setFullscreenImage(null);
    setDetectedFaces([]);
    
    // Reset dan enable detection lagi setelah delay
    setTimeout(() => {
      setShouldAutoDetect(true);
      setIsProcessing(false);
    }, 500);
  };

  // Manual detection trigger
  const manualDetect = () => {
    if (!isProcessing) {
      setShouldAutoDetect(true);
      detectFace();
    }
  };

  // Auto-detection trigger
  useEffect(() => {
    if (hasPermission && device && shouldAutoDetect && !showFullscreen && !isProcessing) {
      const timer = setTimeout(() => {
        detectFace();
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [hasPermission, device, shouldAutoDetect, showFullscreen]);

  // Helper untuk menghitung koordinat display bounding box yang akurat
  const getDisplayCoordinates = (face: Face) => {
    if (!actualImageWidth || !actualImageHeight || imageDisplayDimensions.width === 0) return null;
    
    const scaleX = imageDisplayDimensions.width / actualImageWidth;
    const scaleY = imageDisplayDimensions.height / actualImageHeight;

    // Gunakan koordinat asli dari ML Kit
    const boxLeft = (face.frame.left * scaleX) + imageDisplayDimensions.x - (BOUNDING_BOX_PADDING * scaleX);
    const boxTop = (face.frame.top * scaleY) + imageDisplayDimensions.y - (BOUNDING_BOX_PADDING * scaleY);
    const boxWidth = (face.frame.width * scaleX) + (BOUNDING_BOX_PADDING * 2 * scaleX);
    const boxHeight = (face.frame.height * scaleY) + (BOUNDING_BOX_PADDING * 2 * scaleY);

    // Ensure bounding box doesn't go outside screen bounds
    const finalBoxLeft = Math.max(imageDisplayDimensions.x, boxLeft);
    const finalBoxTop = Math.max(imageDisplayDimensions.y, boxTop);
    const finalBoxWidth = Math.min(boxWidth, imageDisplayDimensions.width - (finalBoxLeft - imageDisplayDimensions.x));
    const finalBoxHeight = Math.min(boxHeight, imageDisplayDimensions.height - (finalBoxTop - imageDisplayDimensions.y));

    return { 
      boxLeft: finalBoxLeft, 
      boxTop: finalBoxTop, 
      boxWidth: finalBoxWidth, 
      boxHeight: finalBoxHeight 
    };
  };

  if (!device || !hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>Loading Camera...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar translucent backgroundColor="transparent" />
      
      {/* Camera View */}
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={!showFullscreen}
        photo={true}
      />

      {/* Status Overlay */}
      <View style={styles.statusOverlay}>
        <Text style={styles.statusText}>
          {isProcessing ? 'Processing...' : `Faces: ${faceCount}`}
        </Text>
        {!showFullscreen && (
          <TouchableOpacity style={styles.detectButton} onPress={manualDetect}>
            <Text style={styles.detectButtonText}>Detect Faces</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Cropped Faces Container */}
      {croppedFaces.length > 0 && (
        <ScrollView horizontal style={styles.croppedFacesContainer} showsHorizontalScrollIndicator={false}>
          {croppedFaces.map((base64, index) => (
            <Image
              key={`face-${index}`}
              source={{ uri: `data:image/${outputFormat.toLowerCase()};base64,${base64}` }}
              style={styles.croppedFace}
            />
          ))}
        </ScrollView>
      )}

      {/* Fullscreen Modal */}
      <Modal
        visible={showFullscreen}
        animationType="slide"
        transparent={false}
        statusBarTranslucent
      >
        <View style={styles.fullscreenContainer}>
          {fullscreenImage && (
            <View style={styles.fullscreenImageContainer}>
              <Image
                source={{ uri: fullscreenImage }}
                style={styles.fullscreenImage}
                resizeMode="contain"
              />
              
              {/* Bounding Box Overlay */}
              {imageDisplayDimensions.width > 0 && (
                <View style={StyleSheet.absoluteFill} pointerEvents="none">
                  <Svg width="100%" height="100%">
                    {detectedFaces.map((face, index) => {
                      const coords = getDisplayCoordinates(face);
                      if (!coords) return null;
                      
                      const { boxLeft, boxTop, boxWidth, boxHeight } = coords;
                      
                      return (
                        <Rect
                          key={index}
                          x={boxLeft}
                          y={boxTop}
                          width={boxWidth}
                          height={boxHeight}
                          stroke="lime"
                          strokeWidth={3}
                          fill="transparent"
                        />
                      );
                    })}
                  </Svg>
                </View>
              )}
              
              {/* Debug Info Overlay */}
              {__DEV__ && (
                <View style={styles.debugOverlay}>
                  <Text style={styles.debugText}>
                    Actual: {actualImageWidth}x{actualImageHeight}
                  </Text>
                  <Text style={styles.debugText}>
                    Display: {Math.round(imageDisplayDimensions.width)}x{Math.round(imageDisplayDimensions.height)}
                  </Text>
                  <Text style={styles.debugText}>
                    Offset: {Math.round(imageDisplayDimensions.x)}, {Math.round(imageDisplayDimensions.y)}
                  </Text>
                </View>
              )}
              
              {/* Format Selection Controls */}
              <View style={styles.formatControls}>
                <Text style={styles.formatLabel}>Format:</Text>
                <View style={styles.formatButtons}>
                  {(['JPEG', 'PNG', 'WEBP'] as const).map((format) => (
                    <TouchableOpacity
                      key={format}
                      style={[
                        styles.formatButton,
                        outputFormat === format && styles.formatButtonActive
                      ]}
                      onPress={() => setOutputFormat(format)}
                    >
                      <Text style={[
                        styles.formatButtonText,
                        outputFormat === format && styles.formatButtonTextActive
                      ]}>
                        {format}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {outputFormat !== 'PNG' && (
                  <View style={styles.qualityControl}>
                    <Text style={styles.formatLabel}>Quality: {imageQuality}%</Text>
                    <View style={styles.qualityButtons}>
                      {[70, 85, 95, 100].map((quality) => (
                        <TouchableOpacity
                          key={quality}
                          style={[
                            styles.qualityButton,
                            imageQuality === quality && styles.formatButtonActive
                          ]}
                          onPress={() => setImageQuality(quality)}
                        >
                          <Text style={[
                            styles.qualityButtonText,
                            imageQuality === quality && styles.formatButtonTextActive
                          ]}>
                            {quality}%
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}
              </View>
              
              {/* Close Button */}
              <View style={styles.buttonContainer}>
                <TouchableOpacity style={styles.closeButton} onPress={closeFullscreen}>
                  <Text style={styles.closeButtonText}>Kembali ke Kamera</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1,
    backgroundColor: 'black'
  },
  center: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center',
    backgroundColor: 'black'
  },
  loadingText: {
    color: 'white',
    fontSize: 18
  },
  statusOverlay: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.8)',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  statusText: { 
    color: 'white', 
    fontSize: 16, 
    fontWeight: 'bold',
    marginBottom: 10
  },
  detectButton: {
    backgroundColor: 'rgba(0, 255, 0, 0.8)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  detectButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold'
  },
  croppedFacesContainer: {
    position: 'absolute',
    bottom: 120,
    left: 0,
    right: 0,
    height: 110,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  croppedFace: {
    width: 100,
    height: 100,
    borderRadius: 10,
    marginHorizontal: 5,
    borderWidth: 2,
    borderColor: 'white',
  },
  fullscreenContainer: {
    flex: 1,
    backgroundColor: 'black',
  },
  fullscreenImageContainer: {
    flex: 1,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenImage: {
    width: '100%',
    height: '100%',
  },
  debugOverlay: {
    position: 'absolute',
    top: 50,
    left: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 10,
    borderRadius: 5,
  },
  debugText: {
    color: 'white',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 50,
    alignSelf: 'center',
  },
  closeButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 25,
  },
  closeButtonText: {
    color: 'black',
    fontSize: 16,
    fontWeight: 'bold',
  },
  formatControls: {
    position: 'absolute',
    top: 50,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.8)',
    padding: 15,
    borderRadius: 10,
    minWidth: 150,
  },
  formatLabel: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  formatButtons: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  formatButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 5,
    marginRight: 5,
  },
  formatButtonActive: {
    backgroundColor: 'rgba(0,255,0,0.8)',
  },
  formatButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  formatButtonTextActive: {
    color: 'black',
  },
  qualityControl: {
    marginTop: 5,
  },
  qualityButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  qualityButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 5,
    marginRight: 5,
    marginBottom: 5,
  },
  qualityButtonText: {
    color: 'white',
    fontSize: 11,
    fontWeight: 'bold',
  },
});