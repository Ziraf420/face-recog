import React, {useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Modal,
  TouchableOpacity,
  Dimensions,
  StatusBar,
  ActivityIndicator,
  FlatList,
  Animated,
} from 'react-native';
import {Camera, useCameraDevices} from 'react-native-vision-camera';
// ImageResizer
import FaceDetection, {
  Face,
  FaceDetectionOptions,
} from '@react-native-ml-kit/face-detection';
import {NativeModules} from 'react-native';
import ReconnectingWebSocket from 'react-native-reconnecting-websocket';
import RNFS from 'react-native-fs';
import Sound from 'react-native-sound';
import ImageResizer from 'react-native-image-resizer';

const {
  ImageFlipModule,
  ImageCropModule,
  ImageRotateModule,
  ImageCompressModule,
} = NativeModules;

// Enhanced constants for better face detection box
const MIN_FACE_SIZE = 120; // Turunkan untuk lebih sensitif
const FACE_BOX_PADDING = 20; // Padding untuk box yang lebih besar
const CORNER_LENGTH_RATIO = 0.25; // Corner lebih besar

// Tingkatkan kualitas dan ukuran gambar
const COMPRESSED_IMAGE_SIZE = 480;
const COMPRESSED_IMAGE_QUALITY = 80;
const PREVIEW_IMAGE_SIZE = 200;
const PREVIEW_IMAGE_QUALITY = 80;
const DETECTION_INTERVAL = 50; // Reduced from 100ms to 50ms for faster detection
const PROCESSING_COOLDOWN = 2000;

type ImageInfo = {
  path: string;
  width: number;
  height: number;
};

type CropPreview = {
  id: string;
  cropImage: string;
  timestamp: number;
  status: 'waiting' | 'recognized' | 'not_recognized';
  personName?: string;
  errorMessage?: string;
};

type DebugInfo = {
  readTime?: number;
  compressTime?: number;
  rotateTime?: number;
  flipTime?: number;
  cropTime?: number;
  compressTimeCrop?: number;
  totalTime?: number;
  originalSize?: number;
  compressedSize?: number;
  faceCount?: number;
  compressionRatio?: number;
  nativeProcessingTime?: number;
  detectionTime?: number; // Added detection time
  captureTime?: number; // Added capture time
  wsTime?: number; // Added WebSocket time
  wsResponseTime?: number; // Added WebSocket response time
  grandTotalTime?: number; // Added grand total time from detection to WS response
};

interface AutoFocusBoxProps {
  x: number;
  y: number;
  size: number;
  visible: boolean;
}

interface FaceDetectionBoxProps {
  face: Face;
  imageDisplayDims: {
    width: number;
    height: number;
    x: number;
    y: number;
  };
  imageInfo: ImageInfo;
  index: number;
}

interface MemoizedCropPreviewItemProps {
  crop: CropPreview;
  onPress: (imagePath: string) => void;
}

const AutoFocusBox: React.FC<AutoFocusBoxProps> = ({x, y, size, visible}) => {
  const scaleAnim = useRef(new Animated.Value(1.2)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      scaleAnim.setValue(1.2);
      opacityAnim.setValue(1);

      Animated.parallel([
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 200,
          delay: 1,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, x, y]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.autoFocusBox,
        {
          left: x - size / 2,
          top: y - size / 2,
          width: size,
          height: size,
          transform: [{scale: scaleAnim}],
          opacity: opacityAnim,
        },
      ]}
    />
  );
};

// Fixed FaceDetectionBox without pulsing animation and smoother rendering
const FaceDetectionBox: React.FC<FaceDetectionBoxProps> = ({
  face,
  imageDisplayDims,
  imageInfo,
  index,
}) => {
  const scaleX = imageDisplayDims.width / imageInfo.width;
  const scaleY = imageDisplayDims.height / imageInfo.height;

  // Add padding for bigger box
  const left =
    imageDisplayDims.x + (face.frame.left - FACE_BOX_PADDING) * scaleX;
  const top = imageDisplayDims.y + (face.frame.top - FACE_BOX_PADDING) * scaleY;
  const width = (face.frame.width + FACE_BOX_PADDING * 2) * scaleX;
  const height = (face.frame.height + FACE_BOX_PADDING * 2) * scaleY;
  const cornerLength = Math.min(width, height) * CORNER_LENGTH_RATIO;

  // REMOVED: Pulsing animation for smoother performance

  return (
    <View
      style={[
        {
          position: 'absolute',
          left,
          top,
          width,
          height,
        },
      ]}>
      {/* Static corner indicators - no animation */}
      <View
        style={[
          styles.faceCorner,
          styles.topLeft,
          {width: cornerLength, height: cornerLength},
        ]}
      />
      <View
        style={[
          styles.faceCorner,
          styles.topRight,
          {width: cornerLength, height: cornerLength},
        ]}
      />
      <View
        style={[
          styles.faceCorner,
          styles.bottomLeft,
          {width: cornerLength, height: cornerLength},
        ]}
      />
      <View
        style={[
          styles.faceCorner,
          styles.bottomRight,
          {width: cornerLength, height: cornerLength},
        ]}
      />

      {/* Center border for clearer outline */}
      <View style={styles.faceCenterBorder} />

      {/* Enhanced face number container */}
      <View style={styles.faceNumberContainer}>
        <Text style={styles.faceNumber}>{index + 1}</Text>
      </View>

      {/* Face size indicator */}
      <View style={styles.faceSizeIndicator}>
        <Text style={styles.faceSizeText}>
          {Math.round(face.frame.width)}x{Math.round(face.frame.height)}
        </Text>
      </View>
    </View>
  );
};

const MemoizedCropPreviewItem = React.memo(
  ({crop, onPress}: MemoizedCropPreviewItemProps) => {
    return (
      <TouchableOpacity
        style={[styles.cropPreviewItem, styles.cropPreviewRecognized]}
        onPress={() => onPress(crop.cropImage)}>
        <Image
          source={{uri: `file://${crop.cropImage}`}}
          style={styles.cropPreviewImage}
          resizeMode="contain"
        />

        <View style={styles.cropPreviewStatus}>
          {crop.status === 'recognized' && (
            <Text style={styles.cropPreviewStatusText}>✅</Text>
          )}
          {crop.status === 'not_recognized' && (
            <Text style={styles.cropPreviewStatusText}>❌</Text>
          )}
        </View>

        {crop.personName && (
          <Text style={styles.cropPreviewPersonName} numberOfLines={1}>
            {crop.personName}
          </Text>
        )}

        {crop.errorMessage && (
          <Text style={styles.cropPreviewError} numberOfLines={1}>
            {crop.errorMessage}
          </Text>
        )}

        <Text style={styles.cropPreviewIndex}>#{crop.id.substring(5, 8)}</Text>
      </TouchableOpacity>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.crop.status === nextProps.crop.status &&
      prevProps.crop.personName === nextProps.crop.personName &&
      prevProps.crop.errorMessage === nextProps.crop.errorMessage
    );
  },
);

export default function App() {
  const [hasPermission, setHasPermission] = useState(false);
  const [faceCount, setFaceCount] = useState(0);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [autoFocus, setAutoFocus] = useState({
    visible: false,
    x: 0,
    y: 0,
    timestamp: 0,
  });
  const [displayFaces, setDisplayFaces] = useState<Face[]>([]);
  const [displayImageInfo, setDisplayImageInfo] = useState<ImageInfo | null>(
    null,
  );
  const [imageDisplayDims, setImageDisplayDims] = useState<{
    width: number;
    height: number;
    x: number;
    y: number;
  } | null>(null);
  const [wsConnection, setWsConnection] =
    useState<ReconnectingWebSocket | null>(null);
  const [wsStatus, setWsStatus] = useState<
    'disconnected' | 'connecting' | 'connected'
  >('disconnected');
  const [cropPreviews, setCropPreviews] = useState<CropPreview[]>([]);
  const [recognitionStatus, setRecognitionStatus] = useState<{
    status: 'idle' | 'processing' | 'recognized' | 'not_recognized';
    personName?: string;
    errorMessage?: string;
  }>({status: 'idle'});
  const [shouldAutoDetect, setShouldAutoDetect] = useState(true);
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false);
  const [isShowingResult, setIsShowingResult] = useState(false);
  const [allowProcessing, setAllowProcessing] = useState(true);
  const [grandTotalTime, setGrandTotalTime] = useState<number>(0);
  const [debugInfo, setDebugInfo] = useState<DebugInfo>({});

  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const resultTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isDetectionRunningRef = useRef<boolean>(false);
  const autoFocusTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const continuousDetectionRef = useRef<NodeJS.Timeout | null>(null);
  const lastDetectionRef = useRef<number>(0);
  const lastProcessingRef = useRef<number>(0);
  const wsSendTimeRef = useRef<number>(0);

  const lastFaceDetectionResult = useRef<{
    faces: Face[];
    imageInfo: ImageInfo;
    timestamp: number;
  } | null>(null);

  const okaySound = useRef<Sound | null>(null);
  const tidakTerdaftarSound = useRef<Sound | null>(null);
  const cameraRef = useRef<Camera>(null);
  const devices = useCameraDevices();
  const device =
    devices.find(d => d.position === 'front') ??
    devices.find(d => d.position === 'back');

  const onPreviewPress = (imagePath: string) => {
    setFullscreenImage(imagePath);
    setShowFullscreen(true);
  };

  // Enhanced face validation with padding consideration
  const hasValidFaceEnhanced = (
    faces: Face[],
    displayDims: any,
    imgInfo: ImageInfo,
  ) => {
    return faces.some(face => {
      const scaleX = displayDims.width / imgInfo.width;
      const scaleY = displayDims.height / imgInfo.height;

      // Calculate size with padding
      const displayWidth = (face.frame.width + FACE_BOX_PADDING * 2) * scaleX;
      const displayHeight = (face.frame.height + FACE_BOX_PADDING * 2) * scaleY;

      return displayWidth >= MIN_FACE_SIZE && displayHeight >= MIN_FACE_SIZE;
    });
  };

  useEffect(() => {
    Sound.setCategory('Playback');

    okaySound.current = new Sound('okay.wav', Sound.MAIN_BUNDLE, error => {
      if (error) console.log('Failed to load okay.wav', error);
      else console.log('okay.wav loaded');
    });

    tidakTerdaftarSound.current = new Sound(
      'tidak_terdaftar.wav',
      Sound.MAIN_BUNDLE,
      error => {
        if (error) console.log('Failed to load tidak_terdaftar.wav', error);
        else console.log('tidak_terdaftar.wav loaded');
      },
    );

    return () => {
      okaySound.current?.release();
      tidakTerdaftarSound.current?.release();
    };
  }, []);

  const playAudio = (soundType: 'okay' | 'tidak_terdaftar') => {
    const sound =
      soundType === 'okay' ? okaySound.current : tidakTerdaftarSound.current;

    if (!sound) {
      console.log(`⚠️ ${soundType} sound not initialized`);
      return;
    }

    sound.play(success => {
      if (success) console.log(`✅ ${soundType} played`);
      else console.log(`❌ Failed to play ${soundType}`);
    });
  };

  const resetAndResumeDetection = () => {
    console.log('🔄 Resetting all states and resuming detection...');

    if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current);

    setRecognitionStatus({status: 'idle'});
    setIsShowingResult(false);
    setAllowProcessing(true);
    setIsProcessing(false);
    setIsWaitingForResponse(false);
    setShouldAutoDetect(true);

    isDetectionRunningRef.current = false;
  };

  const triggerAutoFocus = async (x: number, y: number) => {
    if (!cameraRef.current) return;

    try {
      await cameraRef.current.focus({x, y});

      setAutoFocus({
        visible: true,
        x,
        y,
        timestamp: Date.now(),
      });

      if (autoFocusTimeoutRef.current) {
        clearTimeout(autoFocusTimeoutRef.current);
      }

      autoFocusTimeoutRef.current = setTimeout(() => {
        setAutoFocus(prev => ({...prev, visible: false}));
      }, 1000);
    } catch (error) {
      console.log('Auto focus error:', error);
    }
  };

  const handleScreenTap = (event: any) => {
    if (showFullscreen) return;

    const {locationX, locationY} = event.nativeEvent;
    triggerAutoFocus(locationX, locationY);
  };

  const autoFocusOnFace = async (faces: Face[]) => {
    if (!imageDisplayDims || !displayImageInfo || faces.length === 0) return;

    const largestFace = faces.reduce((prev, curr) => {
      return curr.frame.width * curr.frame.height >
        prev.frame.width * prev.frame.height
        ? curr
        : prev;
    });

    const scaleX = imageDisplayDims.width / displayImageInfo.width;
    const scaleY = imageDisplayDims.height / displayImageInfo.height;

    const faceCenterX =
      imageDisplayDims.x +
      (largestFace.frame.left + largestFace.frame.width / 2) * scaleX;
    const faceCenterY =
      imageDisplayDims.y +
      (largestFace.frame.top + largestFace.frame.height / 2) * scaleY;

    await triggerAutoFocus(faceCenterX, faceCenterY);
  };

  useEffect(() => {
    const ws = new ReconnectingWebSocket('wss://nvr.icode.id/nvidia/', [], {
      reconnectInterval: 2000,
      maxReconnectInterval: 5000,
      reconnectDecay: 1.2,
      timeoutInterval: 3000,
      maxReconnectAttempts: 5,
    });

    ws.onopen = () => {
      console.log('WebSocket connected');
      setWsStatus('connected');
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setWsStatus('disconnected');
    };

    ws.onerror = (error: any) => {
      console.log('WebSocket error:', error);
      setWsStatus('disconnected');
    };

    ws.onmessage = (message: {data: string}) => {
      const receiveTime = Date.now();
      const wsResponseTime = receiveTime - wsSendTimeRef.current;
      // const grandTotalTime = receiveTime - grandTotalStartTime;

      console.log(`⏱️ WS Response Time: ${wsResponseTime}ms`);
      // console.log(`🎯 GRAND TOTAL TIME: ${grandTotalTime}ms (Detection → WS Response)`);

      // Update debug info with response times
      setDebugInfo(prev => ({
        ...prev,
        wsResponseTime,
        // grandTotalTime,
      }));

      try {
        const data = JSON.parse(message.data);
        console.log('📋 WebSocket response:', data);

        if (data.type === 'check_person' || data.name) {
          const personName = data.name;
          console.log('👤 Person detected:', personName);

          setIsWaitingForResponse(false);
          setIsProcessing(false);
          setIsShowingResult(true);

          const isUnknownDone2 = personName === 'Unknown_done2';
          const isUnknownDone = personName === 'Unknown_done';
          const isRecognized = !isUnknownDone && !isUnknownDone2;

          let status: 'recognized' | 'not_recognized' = 'not_recognized';
          let errorMessage = '';

          if (isUnknownDone2) {
            errorMessage =
              data.return_result?.error ||
              'Wajah tidak dikenali (Unknown_done2)';
          } else if (isUnknownDone) {
            errorMessage = 'Wajah tidak terdaftar';
          }

          setCropPreviews(prev => {
            const updatedCrops = [...prev];
            const pendingCropIndex = updatedCrops.findIndex(
              crop => crop.status === 'waiting',
            );

            if (pendingCropIndex !== -1) {
              updatedCrops[pendingCropIndex] = {
                ...updatedCrops[pendingCropIndex],
                status: isRecognized ? 'recognized' : 'not_recognized',
                personName: isRecognized ? personName : undefined,
                errorMessage: isRecognized ? undefined : errorMessage,
              };
            }

            return updatedCrops;
          });

          setRecognitionStatus({
            status: isRecognized ? 'recognized' : 'not_recognized',
            personName: isRecognized ? personName : undefined,
            errorMessage: isRecognized ? undefined : errorMessage,
          });

          setTimeout(() => {
            if (isRecognized) {
              playAudio('okay');
            } else if (isUnknownDone) {
              playAudio('tidak_terdaftar');
            }

            setTimeout(
              () => {
                resetAndResumeDetection();
              },
              isRecognized ? 1500 : 500,
            );
          }, 300);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
        resetAndResumeDetection();
      }
    };

    setWsConnection(ws);
    return () => {
      // Keep WebSocket alive
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const status = await Camera.requestCameraPermission();
        setHasPermission(status === 'granted');

        if (status === 'granted') {
          try {
            await Camera.requestMicrophonePermission();
          } catch (micError) {
            console.log('Microphone permission not needed:', micError);
          }
        }
      } catch (error) {
        console.error('Permission error:', error);
        setHasPermission(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (hasPermission && device && shouldAutoDetect && !showFullscreen) {
      const startContinuousDetection = () => {
        const detectContinuously = () => {
          if (
            shouldAutoDetect &&
            !showFullscreen &&
            !isDetectionRunningRef.current
          ) {
            detectFacesOptimized();
          }
          continuousDetectionRef.current = setTimeout(
            detectContinuously,
            DETECTION_INTERVAL,
          );
        };
        detectContinuously();
      };

      startContinuousDetection();

      return () => {
        if (continuousDetectionRef.current) {
          clearTimeout(continuousDetectionRef.current);
        }
      };
    }
  }, [hasPermission, device, shouldAutoDetect, showFullscreen]);

  useEffect(() => {
    return () => {
      if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current);
      if (autoFocusTimeoutRef.current)
        clearTimeout(autoFocusTimeoutRef.current);
      if (continuousDetectionRef.current)
        clearTimeout(continuousDetectionRef.current);
    };
  }, []);

  const detectFacesOptimized = async () => {
    if (!cameraRef.current || isDetectionRunningRef.current || showFullscreen) {
      return;
    }

    const detectionStartTime = Date.now(); // Overall detection start time
    const currentTime = Date.now();
    isDetectionRunningRef.current = true;
    lastDetectionRef.current = currentTime;

    try {
      console.log('🔍 Starting optimized face detection...');

      // Time the camera capture with optimized settings
      const captureStartTime = Date.now();
      const photo = await cameraRef.current.takePhoto({
        flash: 'off',
        enableShutterSound: false,
        // qualityPrioritization: 'speed', // Prioritize speed over quality
      });
      const captureTime = Date.now() - captureStartTime;
      const resizestartTime = Date.now();
      const rotatedImage = await ImageResizer.createResizedImage(
        photo.path,
        640,
        480,
        'JPEG',
        80,
        -90, // Nilai rotate degree, 90=rotate right, -90=rotate left
      );
      const resizetime = Date.now() - resizestartTime;
      const imgInfo: ImageInfo = {
        path: rotatedImage.path,
        width: rotatedImage.height,
        height: rotatedImage.width,
      };
      console.log(`📷 Image captured: ${rotatedImage.path}`);
      console.log("base64",await RNFS.readFile(rotatedImage.path,'base64'))

      setDisplayImageInfo(imgInfo);

      // Optimized face detection options for speed
      const options: FaceDetectionOptions = {
        performanceMode: 'fast', // Already set, good
        landmarkMode: 'none', // Skip landmarks for speed
        contourMode: 'none', // Skip contours for speed
        classificationMode: 'none', // Skip classification for speed
        minFaceSize: 0.1, // Slightly increase to reduce false positives
      };

      // Time the actual face detection
      const faceDetectionStartTime = Date.now();
      const faces = await FaceDetection.detect(`file://${rotatedImage.path}`, options);
      const faceDetectionTime = Date.now() - faceDetectionStartTime;
      const totalDetectionTime = Date.now() - detectionStartTime; // Total time including capture

      console.log(`📸 Camera capture: ${captureTime}ms`);
      console.log(`🔍 Face detection: ${faceDetectionTime}ms`);
      console.log(`⚡ Total detection: ${totalDetectionTime}ms`);
      console.log(`🖼️ reziseimage di detectface: ${resizetime}ms`);
      console.log(`👤 Faces detected: ${faces.length}`);

      setGrandTotalTime(totalDetectionTime + captureTime + totalDetectionTime);

      lastFaceDetectionResult.current = {
        faces,
        imageInfo: imgInfo,
        timestamp: currentTime,
      };

      const displayDims = calculateImageDisplayDimensions(
        imgInfo.width,
        imgInfo.height,
      );

      // Update states immediately for no delay
      setFaceCount(faces.length);
      
      setDisplayFaces(faces);
      setImageDisplayDims(displayDims);

      // Update debug info with separated times
      setDebugInfo(prev => ({
        ...prev,
        captureTime,
        detectionTime: totalDetectionTime,
        faceCount: faces.length,
      }));

      if (faces.length > 0 && currentTime - lastDetectionRef.current > 2000) {
        autoFocusOnFace(faces);
      }
      console.log(`👁️ Face count: ${faces.length}`);
      console.log ('time face detection:', currentTime-lastDetectionRef.current, 'ms');
      console.log('allowProcessing:', allowProcessing);
      console.log('isProcessing:', isProcessing);
      console.log('isWaitingForResponse:', isWaitingForResponse);
      console.log('isShowingResult:', isShowingResult);

      if (
        faces.length > 0 &&
        allowProcessing &&
        !isProcessing &&
        !isWaitingForResponse &&
        !isShowingResult
      ) {
        // Use enhanced face validation
        const hasValidFace = hasValidFaceEnhanced(faces, displayDims, imgInfo);

        if (
          hasValidFace &&
          currentTime - lastProcessingRef.current > PROCESSING_COOLDOWN
        ) {
          console.log('✅ Valid face found with detection, processing...');
          lastProcessingRef.current = currentTime;

          // Set grand total start time for complete process tracking
          // setGrandTotalStartTime(totalDetectionTime);

          processAndSendImageOptimized(imgInfo, faces);
        }
      }
    } catch (err) {
      console.error('❌ Face detection error:', err);
    } finally {
      isDetectionRunningRef.current = false;
    }
  };

  const calculateImageDisplayDimensions = (
    imgWidth: number,
    imgHeight: number,
  ) => {
    const screenWidth = Dimensions.get('window').width;
    const screenHeight = Dimensions.get('window').height;

    const imageRatio = imgWidth / imgHeight;
    const screenRatio = screenWidth / screenHeight;

    let width,
      height,
      offsetX = 0,
      offsetY = 0;

    if (imageRatio > screenRatio) {
      width = screenWidth;
      height = screenWidth / imageRatio;
      offsetY = (screenHeight - height) / 2;
    } else {
      height = screenHeight;
      width = screenHeight * imageRatio;
      offsetX = (screenWidth - width) / 2;
    }

    return {width, height, x: offsetX, y: offsetY};
  };

  const processAndSendImageOptimized = async (
    imageInfo: ImageInfo,
    faces: Face[],
  ) => {
    const processStartTime = Date.now();
    let readTime = 0,
      rotateTime = 0,
      flipTime = 0,
      cropTime = 0,
      compressTime = 0,
      totalTime = 0;
    let originalBase64 = '',
      rotatedBase64 = '',
      flippedBase64 = '',
      cropBase64 = '';
    let base64ForWebSocket = '';

    try {
      setIsProcessing(true);
      setAllowProcessing(false);
      setRecognitionStatus({status: 'processing'});
      setShouldAutoDetect(false);

      // 1. Read file
      const readStart = Date.now();
      originalBase64 = await RNFS.readFile(imageInfo.path, 'base64');
      readTime = Date.now() - readStart;

      // 2. Rotate
      // const rotateStart = Date.now();
      // rotatedBase64 = await ImageRotateModule.rotateBase64Image(
      //   originalBase64,
      //   -90,
      // );
      // rotateTime = Date.now() - rotateStart;

      // 3. Flip
      const flipStart = Date.now();
      flippedBase64 = await ImageFlipModule.flipBase64Image(
        originalBase64,
        'horizontal',
      );
      flipTime = Date.now() - flipStart;

      // 4. Crop
      cropBase64 = flippedBase64;
      cropTime = 0;
      if (faces.length > 0) {
        const largestFace = faces.reduce((prev, curr) =>
          curr.frame.width * curr.frame.height >
          prev.frame.width * prev.frame.height
            ? curr
            : prev,
        );

        const cropStart = Date.now();
        try {
          // Tentukan tinggi yang diinginkan (contoh: 1.5x tinggi wajah)
          const heightMultiplier = 1.5;
          const desiredHeight = Math.round(
            largestFace.frame.height * heightMultiplier,
          );

          cropBase64 = await ImageCropModule.cropFace(
            flippedBase64,
            Math.round(largestFace.frame.left),
            Math.round(largestFace.frame.top),
            Math.round(largestFace.frame.width),
            Math.round(largestFace.frame.height), // Tinggi asli
            desiredHeight, // PARAMETER BARU: tinggi yang diinginkan
          );
        } catch (e) {
          cropBase64 = flippedBase64;
          console.warn('Crop failed, fallback to flipped image', e);
        }
        cropTime = Date.now() - cropStart;
      }

      // 5. Compress for WebSocket
      const compressStart = Date.now();
      // try {
      //   const compressionResult = await ImageCompressModule.compressBase64Image(
      //     cropBase64,
      //     COMPRESSED_IMAGE_SIZE,
      //     COMPRESSED_IMAGE_SIZE,
      //     COMPRESSED_IMAGE_QUALITY,
      //   );
      //   base64ForWebSocket = compressionResult.base64;
      // } catch (e) {
      //   base64ForWebSocket = cropBase64;
      //   console.warn('Compression error, fallback to cropBase64', e);
      // }
      compressTime = Date.now() - compressStart;

      // 6. Create preview image
      // const previewCompressStart = Date.now();
      // console.log("base64",await RNFS.readFile(, 'base64'))
      let previewBase64 = cropBase64;
      let base64ForWebSocket = cropBase64
      // try {
      //   const previewCompressionResult =
      //     await ImageCompressModule.compressBase64Image(
      //       cropBase64,
      //       PREVIEW_IMAGE_SIZE,
      //       PREVIEW_IMAGE_SIZE,
      //       PREVIEW_IMAGE_QUALITY,
      //     );
      //   previewBase64 = previewCompressionResult.base64;
      // } catch (e) {
      //   console.warn('Preview compression failed, using WS image', e);
      // }

      // 7. Save preview image
      const cropId = `crop_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      const previewPath = `${RNFS.CachesDirectoryPath}/preview_${cropId}.jpg`;
      await RNFS.writeFile(previewPath, previewBase64, 'base64');

      const newCropPreview: CropPreview = {
        id: cropId,
        cropImage: previewPath,
        timestamp: Date.now(),
        status: 'waiting',
      };

      setCropPreviews(prev => [newCropPreview, ...prev].slice(0, 10));

      // 8. Send to WebSocket
      if (wsConnection && wsStatus === 'connected') {
        setIsWaitingForResponse(true);

        const wsStartTime = Date.now();
        wsSendTimeRef.current = wsStartTime;
        wsConnection.send(`11:check_image:${base64ForWebSocket}:11:11e`);
        const wsTime = Date.now() - wsStartTime;

        console.log(`📡 WebSocket send: ${wsTime}ms`);

        // Update debug info with WS send time
        setDebugInfo(prev => ({
          ...prev,
          wsTime,
        }));
      }

      // 9. Update debug info
      totalTime = Date.now() - processStartTime;
      setDebugInfo(prev => ({
        ...prev,
        readTime,
        rotateTime,
        flipTime,
        cropTime,
        compressTime,
        totalTime,
        // originalSize: originalBase64.length,
        // compressedSize: base64ForWebSocket.length,
        faceCount: faces.length,
      }));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('Processing error:', errorMsg);

      setRecognitionStatus({
        status: 'not_recognized',
        errorMessage: `Error: ${errorMsg}`,
      });

      setCropPreviews(prev => {
        if (prev.length > 0 && prev[0].status === 'waiting') {
          const updatedCrops = [...prev];
          updatedCrops[0] = {
            ...updatedCrops[0],
            status: 'not_recognized',
            errorMessage: `Error: ${errorMsg}`,
          };
          return updatedCrops;
        }
        return prev;
      });

      setTimeout(() => {
        playAudio('tidak_terdaftar');
        setTimeout(() => resetAndResumeDetection(), 500);
      }, 300);
    } finally {
      setIsProcessing(false);
    }
    setGrandTotalTime(grandTotalTime + totalTime);
    setDebugInfo(prev => ({
      ...prev,
      grandTotalTime,
    }));
  };

  // Clean up cache periodically
  useEffect(() => {
    const cleanupCache = async () => {
      try {
        const files = await RNFS.readDir(RNFS.CachesDirectoryPath);
        const now = Date.now();
        files.forEach(file => {
          if (file.isFile() && file.name.startsWith('preview_')) {
            const fileMtime = file.mtime ? file.mtime.valueOf() : now;
            if (now - fileMtime > 1000 * 60 * 60) {
              RNFS.unlink(file.path).catch(e =>
                console.warn(`Failed to delete ${file.path}:`, e),
              );
            }
          }
        });
      } catch (e) {
        console.warn('Failed to clean cache:', e);
      }
    };

    const interval = setInterval(cleanupCache, 1000 * 60 * 30);
    cleanupCache();

    return () => clearInterval(interval);
  }, []);

  const renderFaceBoxes = () => {
    if (
      !imageDisplayDims ||
      !displayImageInfo ||
      displayFaces.length === 0 ||
      showFullscreen
    ) {
      return null;
    }

    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {displayFaces.map((face, index) => (
          <FaceDetectionBox
            key={`${face.frame.left}-${face.frame.top}-${index}`}
            face={face}
            imageDisplayDims={imageDisplayDims}
            imageInfo={displayImageInfo}
            index={index}
          />
        ))}
      </View>
    );
  };

  const closeFullscreen = () => {
    setShowFullscreen(false);
    setFullscreenImage(null);
  };

  if (!device || !hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>Loading Camera...</Text>
        <Text style={styles.subLoadingText}>Face Detection Ready</Text>
      </View>
    );
  }

  const shouldShowDetectionOverlay =
    faceCount === 0 &&
    recognitionStatus.status === 'idle' &&
    !showFullscreen &&
    !isWaitingForResponse &&
    !isShowingResult &&
    !isProcessing;

  const recognizedCrops = cropPreviews.filter(
    crop => crop.status === 'recognized',
  );

  // setGrandTotalTime=(wsresponetime + readtime + rotatetime + fliptime + croptime + compressTime);

  return (
    <View style={styles.container}>
      <StatusBar translucent backgroundColor="transparent" />

      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={handleScreenTap}>
        <Camera
          ref={cameraRef}
          style={showFullscreen ? styles.hiddenCamera : StyleSheet.absoluteFill}
          device={device}
          isActive={true}
          photo={true}
          resizeMode="contain"
          enableZoomGesture={false}
          enableFpsGraph={false}
          lowLightBoost={false}
          format={device?.formats.find(
            format =>
              format.photoWidth <= 1920 && // Limit photo resolution for speed
              format.photoHeight <= 1080 &&
              format.maxFps >= 30,
          )}
        />
      </TouchableOpacity>

      <AutoFocusBox
        x={autoFocus.x}
        y={autoFocus.y}
        size={60}
        visible={autoFocus.visible}
      />

      {renderFaceBoxes()}

      {shouldShowDetectionOverlay && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#00ff00" />
          <Text style={styles.loadingText}>Mendeteksi wajah...</Text>
          <Text style={styles.optimizedText}>⚡Fast Detection Mode</Text>
          <Text style={styles.wsStatus}>
            WebSocket:{' '}
            {wsStatus === 'connected'
              ? '✅ Connected'
              : wsStatus === 'connecting'
              ? '🔄 Connecting'
              : '❌ Disconnected'}
          </Text>
        </View>
      )}

      {(isWaitingForResponse || isProcessing) && (
        <View style={styles.processingOverlay}>
          <ActivityIndicator size="small" color="white" />
          <Text style={styles.processingText}>
            {isWaitingForResponse
              ? '⏳ Menunggu hasil...'
              : '⚡ Memproses dengan Box...'}
          </Text>
        </View>
      )}

      {(recognitionStatus.status === 'recognized' ||
        recognitionStatus.status === 'not_recognized') && (
        <View
          style={[
            styles.recognitionResultOverlay,
            recognitionStatus.status === 'recognized' &&
              styles.recognizedStatus,
            recognitionStatus.status === 'not_recognized' &&
              styles.notRecognizedStatus,
          ]}>
          {recognitionStatus.status === 'recognized' ? (
            <>
              <Text style={styles.recognitionStatusText}>
                ✅ Wajah Dikenali
              </Text>
              <Text style={styles.recognitionPersonName}>
                {recognitionStatus.personName}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.recognitionStatusText}>
                ❌ Wajah Tidak Dikenali
              </Text>
              {recognitionStatus.errorMessage && (
                <Text style={styles.recognitionErrorText}>
                  {recognitionStatus.errorMessage}
                </Text>
              )}
            </>
          )}
        </View>
      )}

      <View style={styles.debugOverlay}>
        <Text style={styles.debugTitle}>🔍 Performance</Text>

        {debugInfo.captureTime !== undefined && (
          <Text style={[styles.debugText, styles.captureTimeText]}>
            Capture: {debugInfo.captureTime}ms
          </Text>
        )}
        {debugInfo.detectionTime !== undefined && (
          <Text style={[styles.debugText, styles.detectionTimeText]}>
            Detect: {debugInfo.detectionTime}ms
          </Text>
        )}
        {debugInfo.readTime !== undefined && (
          <Text style={styles.debugText}>Read: {debugInfo.readTime}ms</Text>
        )}
        {debugInfo.rotateTime !== undefined && (
          <Text style={styles.debugText}>Rotate: {debugInfo.rotateTime}ms</Text>
        )}
        {debugInfo.flipTime !== undefined && (
          <Text style={styles.debugText}>Flip: {debugInfo.flipTime}ms</Text>
        )}
        {debugInfo.cropTime !== undefined && (
          <Text style={styles.debugText}>Crop: {debugInfo.cropTime}ms</Text>
        )}
        {debugInfo.compressTime !== undefined && (
          <Text style={styles.debugText}>
            Compress: {debugInfo.compressTime}ms
          </Text>
        )}
        {debugInfo.wsTime !== undefined && (
          <Text style={[styles.debugText, styles.wsTimeText]}>
            WS Send: {debugInfo.wsTime}ms
          </Text>
        )}
        {debugInfo.wsResponseTime !== undefined && (
          <Text style={[styles.debugText, styles.wsResponseTimeText]}>
            WS Response: {debugInfo.wsResponseTime}ms
          </Text>
        )}
        {debugInfo.totalTime !== undefined && (
          <Text style={[styles.debugText, styles.totalTimeText]}>
            Process: {debugInfo.totalTime}ms
          </Text>
        )}
        {debugInfo.grandTotalTime !== undefined && (
          <Text style={[styles.debugText, styles.grandTotalTimeText]}>
            TOTAL: {debugInfo.grandTotalTime}ms
          </Text>
        )}
        {debugInfo.compressedSize !== undefined && (
          <Text style={styles.debugText}>
            Size: {Math.round(debugInfo.compressedSize / 1024)}KB
          </Text>
        )}
        {debugInfo.faceCount !== undefined && (
          <Text style={styles.debugText}>Faces: {debugInfo.faceCount}</Text>
        )}
        <Text style={styles.optimizedLabel}>📦 Complete Timing</Text>
      </View>

      {recognizedCrops.length > 0 && (
        <View style={styles.cropPreviewContainer}>
          <Text style={styles.cropPreviewTitle}>Recognition Results</Text>
          <FlatList
            horizontal
            data={recognizedCrops}
            keyExtractor={item => item.id}
            renderItem={({item}) => (
              <MemoizedCropPreviewItem crop={item} onPress={onPreviewPress} />
            )}
            contentContainerStyle={styles.cropPreviewScroll}
            initialNumToRender={3}
            maxToRenderPerBatch={3}
            windowSize={5}
            removeClippedSubviews
          />
        </View>
      )}

      <Modal
        visible={showFullscreen}
        animationType="slide"
        transparent={false}
        statusBarTranslucent>
        <View style={styles.fullscreenContainer}>
          {fullscreenImage && (
            <>
              <Image
                source={{uri: `file://${fullscreenImage}`}}
                style={styles.fullscreenImageSimple}
                resizeMode="contain"
              />
              <View style={styles.buttonContainer}>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={closeFullscreen}>
                  <Text style={styles.closeButtonText}>🔙 Back</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'black',
  },
  loadingText: {
    color: 'white',
    fontSize: 18,
    marginTop: 20,
    fontWeight: '600',
  },
  subLoadingText: {
    color: '#00ff00',
    fontSize: 14,
    marginTop: 8,
    fontStyle: 'italic',
  },
  optimizedText: {
    color: '#00ff00',
    fontSize: 14,
    marginTop: 5,
    fontWeight: 'bold',
  },
  optimizedLabel: {
    color: '#00ff00',
    fontSize: 10,
    marginTop: 5,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  wsStatus: {
    color: 'white',
    fontSize: 14,
    marginTop: 10,
  },
  hiddenCamera: {
    width: 0,
    height: 0,
  },
  autoFocusBox: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#00ff00',
    backgroundColor: 'transparent',
    zIndex: 10,
    borderRadius: 4,
  },

  // Static Face Detection Box Styles (No Animation)
  faceCorner: {
    position: 'absolute',
    borderColor: '#00FF00',
    backgroundColor: 'transparent',
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    shadowColor: '#00FF00',
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.8,
    shadowRadius: 3,
    elevation: 5,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    shadowColor: '#00FF00',
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.8,
    shadowRadius: 3,
    elevation: 5,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    shadowColor: '#00FF00',
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.8,
    shadowRadius: 3,
    elevation: 5,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    shadowColor: '#00FF00',
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.8,
    shadowRadius: 3,
    elevation: 5,
  },

  // Center border for clearer outline
  faceCenterBorder: {
    position: 'absolute',
    top: '25%',
    left: '25%',
    right: '25%',
    bottom: '25%',
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 0, 0.3)',
    borderStyle: 'dashed',
  },

  // Static face number container (no animation)
  faceNumberContainer: {
    position: 'absolute',
    top: -35,
    left: 0,
    backgroundColor: 'rgba(0, 255, 0, 0.95)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 15,
    minWidth: 30,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.8,
    shadowRadius: 3,
    elevation: 5,
  },
  faceNumber: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },

  // Face size indicator
  faceSizeIndicator: {
    position: 'absolute',
    bottom: -35,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#00FF00',
  },
  faceSizeText: {
    color: '#00FF00',
    fontSize: 10,
    fontWeight: '600',
  },

  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    zIndex: 3,
  },
  processingOverlay: {
    position: 'absolute',
    top: 50,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.9)',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    flexDirection: 'row',
    minWidth: 200,
    zIndex: 10,
    borderWidth: 2,
    borderColor: '#00ff00',
  },
  processingText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  recognitionResultOverlay: {
    position: 'absolute',
    bottom: 200,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.95)',
    padding: 20,
    borderRadius: 15,
    alignItems: 'center',
    minWidth: 250,
    zIndex: 10,
    borderWidth: 2,
  },
  recognizedStatus: {
    borderColor: '#00ff00',
    backgroundColor: 'rgba(0,255,0,0.85)',
  },
  notRecognizedStatus: {
    borderColor: '#ff4444',
    backgroundColor: 'rgba(255, 68, 68, 0.85)',
  },
  recognitionStatusText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 8,
    textAlign: 'center',
  },
  recognitionPersonName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 5,
    textAlign: 'center',
  },
  recognitionErrorText: {
    color: '#ffffff',
    fontSize: 14,
    marginTop: 5,
    textAlign: 'center',
  },
  debugOverlay: {
    position: 'absolute',
    top: 50,
    right: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    padding: 12,
    borderRadius: 8,
    zIndex: 100,
    maxWidth: '65%',
    borderWidth: 1,
    borderColor: '#00ff00',
  },
  debugTitle: {
    color: '#00ff00',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 5,
    textAlign: 'center',
  },
  debugText: {
    color: 'white',
    fontSize: 12,
    lineHeight: 16,
  },
  captureTimeText: {
    color: '#ff6600',
    fontWeight: 'bold',
    fontSize: 13,
  },
  detectionTimeText: {
    color: '#ffaa00',
    fontWeight: 'bold',
    fontSize: 13,
  },
  wsTimeText: {
    color: '#00aaff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  wsResponseTimeText: {
    color: '#0088ff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  grandTotalTimeText: {
    color: '#ff0066',
    fontWeight: 'bold',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  totalTimeText: {
    color: '#00ff00',
    fontWeight: 'bold',
    fontSize: 13,
  },
  cropPreviewContainer: {
    position: 'absolute',
    bottom: 20,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.9)',
    borderRadius: 12,
    padding: 12,
    zIndex: 1,
    borderWidth: 1,
    borderColor: '#00ff00',
  },
  cropPreviewTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  cropPreviewScroll: {
    maxHeight: 120,
  },
  cropPreviewItem: {
    marginRight: 12,
    alignItems: 'center',
    borderRadius: 8,
    padding: 6,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: 'rgba(255,255,255,0.1)',
    width: 100,
  },
  cropPreviewRecognized: {
    borderColor: '#00ff00',
    backgroundColor: 'rgba(0,255,0,0.1)',
  },
  cropPreviewImage: {
    width: 120,
    height: 75,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  cropPreviewStatus: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cropPreviewStatusText: {
    fontSize: 12,
    textAlign: 'center',
  },
  cropPreviewPersonName: {
    color: '#00ff00',
    fontSize: 10,
    fontWeight: 'bold',
    marginTop: 2,
    maxWidth: 90,
    textAlign: 'center',
  },
  cropPreviewError: {
    color: '#ff5555',
    fontSize: 9,
    marginTop: 2,
    textAlign: 'center',
    maxWidth: 90,
  },
  cropPreviewIndex: {
    color: 'white',
    fontSize: 10,
    marginTop: 2,
    textAlign: 'center',
  },
  fullscreenContainer: {
    flex: 1,
    backgroundColor: 'black',
  },
  fullscreenImageSimple: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 50,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
    justifyContent: 'center',
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
});
