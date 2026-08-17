import { useEffect, useRef, useState } from 'react';
import { Camera, Trash2, Check, X, RefreshCw, FileText, Loader2 } from 'lucide-react';
import { jsPDF } from 'jspdf';

interface CameraCaptureModalProps {
  open: boolean;
  onClose: () => void;
  documentTypeLabel: string;
  documentTypeValue: string;
  onSave: (file: File) => void;
}

export default function CameraCaptureModal({
  open,
  onClose,
  documentTypeLabel,
  documentTypeValue,
  onSave,
}: CameraCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [capturedImages, setCapturedImages] = useState<string[]>([]);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment'); // default to rear camera

  // List video input devices
  const getDevices = async () => {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = allDevices.filter(device => device.kind === 'videoinput');
      setDevices(videoDevices);
      if (videoDevices.length > 0 && !selectedDeviceId) {
        // Prefer rear camera ("environment") if available
        const backCam = videoDevices.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('rear'));
        setSelectedDeviceId(backCam ? backCam.deviceId : videoDevices[0].deviceId);
      }
    } catch (err) {
      console.error('Error listing devices:', err);
    }
  };

  // Start the camera stream
  const startCamera = async () => {
    stopCamera();
    setError('');

    const constraints: MediaStreamConstraints = {
      video: selectedDeviceId
        ? { 
            deviceId: { exact: selectedDeviceId },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          }
        : { 
            facingMode: { ideal: facingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          }
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      // Re-list devices in case permissions just got granted
      getDevices();
    } catch (err: any) {
      console.error('Error accessing camera:', err);
      setError(
        'Could not access the camera. Please make sure you grant camera permissions and are running on a secure (HTTPS) connection.'
      );
    }
  };

  // Stop all camera tracks
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  // Trigger camera on mount/open/device selection
  useEffect(() => {
    if (open) {
      getDevices();
      startCamera();
    }
    return () => {
      stopCamera();
    };
  }, [open, selectedDeviceId, facingMode]);

  // Capture a single frame
  const capturePhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // If we are using the user-facing (front) camera, mirror the image back to normal representation
      const isMirrored = selectedDeviceId 
        ? devices.find(d => d.deviceId === selectedDeviceId)?.label.toLowerCase().includes('front')
        : facingMode === 'user';

      if (isMirrored) {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      setCapturedImages(prev => [...prev, dataUrl]);
    }
  };

  // Handle toggling between front and back camera (facingMode)
  const toggleFacingMode = () => {
    setSelectedDeviceId(''); // Reset exact device ID to allow facingMode choice
    setFacingMode(prev => (prev === 'user' ? 'environment' : 'user'));
  };

  // Remove a captured thumbnail
  const removeImage = (index: number) => {
    setCapturedImages(prev => prev.filter((_, i) => i !== index));
  };

  // Helper to load image and extract dimensions
  const getImageDimensions = (base64Str: string): Promise<{ width: number; height: number }> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.src = base64Str;
    });
  };

  // Compile PDF and return it to parent component
  const handleSave = async () => {
    if (capturedImages.length === 0) return;
    setIsGenerating(true);
    
    try {
      // Initialize A4 size PDF
      const doc = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = 210;
      const pageHeight = 297;

      for (let i = 0; i < capturedImages.length; i++) {
        if (i > 0) {
          doc.addPage();
        }
        
        // Fetch image dimensions to preserve aspect ratio
        const dims = await getImageDimensions(capturedImages[i]);
        const imgRatio = dims.width / dims.height;
        const pageRatio = pageWidth / pageHeight;

        let drawWidth = pageWidth;
        let drawHeight = pageHeight;
        let x = 0;
        let y = 0;

        if (imgRatio > pageRatio) {
          // Image is wider than A4 layout
          drawWidth = pageWidth;
          drawHeight = pageWidth / imgRatio;
          y = (pageHeight - drawHeight) / 2; // center vertically
        } else {
          // Image is taller than A4 layout
          drawHeight = pageHeight;
          drawWidth = pageHeight * imgRatio;
          x = (pageWidth - drawWidth) / 2; // center horizontally
        }

        // Draw captured image preserving its original shape
        doc.addImage(capturedImages[i], 'JPEG', x, y, drawWidth, drawHeight);
      }

      const pdfBlob = doc.output('blob');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `${documentTypeValue}_scanned_${timestamp}.pdf`;
      const file = new File([pdfBlob], fileName, { type: 'application/pdf' });

      onSave(file);
      stopCamera();
      onClose();
      setCapturedImages([]);
    } catch (err) {
      console.error('Error generating PDF:', err);
      setError('Failed to generate PDF document.');
    } finally {
      setIsGenerating(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
      <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Camera className="h-5 w-5 text-[#2AA7A0]" />
              Scan {documentTypeLabel}
            </h3>
            <p className="text-xs text-slate-500">Capture single or multiple images to compile into a PDF</p>
          </div>
          <button 
            onClick={() => { stopCamera(); onClose(); }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col md:flex-row gap-6 min-h-0">
          
          {/* Left: Camera Feed */}
          <div className="flex-1 flex flex-col bg-slate-950 rounded-xl overflow-hidden relative group min-h-[300px] justify-center items-center">
            {error ? (
              <div className="p-6 text-center text-rose-400 text-sm">{error}</div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover max-h-[450px]"
                />
                
                {/* Control Overlay */}
                <div className="absolute bottom-4 left-0 right-0 flex justify-center items-center gap-4 px-4">
                  {devices.length > 1 && (
                    <button
                      type="button"
                      onClick={toggleFacingMode}
                      className="p-3 bg-white/15 backdrop-blur-md hover:bg-white/25 rounded-full text-white transition-all shadow-lg hover:scale-105 active:scale-95 cursor-pointer"
                      title="Switch Camera Mode"
                    >
                      <RefreshCw className="h-5 w-5" />
                    </button>
                  )}
                  
                  <button
                    type="button"
                    onClick={capturePhoto}
                    className="p-5 bg-gradient-to-r from-[#2AA7A0] to-[#238F89] hover:from-[#238F89] hover:to-[#217d78] rounded-full text-white transition-all shadow-xl hover:scale-110 active:scale-95 border-4 border-white/20 cursor-pointer"
                    title="Capture Photo"
                  >
                    <Camera className="h-6 w-6" />
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Right: Capture Queue & Preview */}
          <div className="w-full md:w-64 flex flex-col border border-slate-100 rounded-xl bg-slate-50 p-4 max-h-[450px]">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 block">
              Captured Pages ({capturedImages.length})
            </span>
            
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-[150px]">
              {capturedImages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-xs text-slate-400 p-4 border border-dashed border-slate-200 rounded-lg">
                  <FileText className="h-8 w-8 mb-2 text-slate-300" />
                  No pages captured yet. Click the camera button to take a photo.
                </div>
              ) : (
                capturedImages.map((img, idx) => (
                  <div key={idx} className="relative group/thumb border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm flex items-center p-2">
                    <img src={img} className="w-12 h-16 object-cover rounded border border-slate-100" alt={`Page ${idx + 1}`} />
                    <span className="ml-3 text-xs font-medium text-slate-700 flex-1">Page {idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeImage(idx)}
                      className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                      title="Delete Page"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={handleSave}
                disabled={capturedImages.length === 0 || isGenerating}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white font-semibold py-2.5 px-4 text-xs transition-colors cursor-pointer"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating PDF...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Save as PDF
                  </>
                )}
              </button>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
