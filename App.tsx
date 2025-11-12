import React, { useState, useRef, useEffect, MouseEvent } from 'react';
import { AppState, Point, PixelCoords, RealCoords, Area } from './types';
import { Upload, Ruler, Target, MapPin, X, Save, Trash2, RefreshCcw, MousePointerClick, Download, Pencil, Check, FileText, Shapes, DownloadCloud } from 'lucide-react';

// Add TypeScript declaration for pdf.js and jsPDF libraries loaded via script tags
declare global {
    interface Window {
        pdfjsLib: any;
        jspdf: any;
    }
}

export const App: React.FC = () => {
    const [appState, setAppState] = useState<AppState>(AppState.UPLOAD_IMAGE);
    const [imageSrc, setImageSrc] = useState<string | null>(null);
    const [points, setPoints] = useState<Point[]>([]);
    const [areas, setAreas] = useState<Area[]>([]);
    
    const [calibrationPoints, setCalibrationPoints] = useState<PixelCoords[]>([]);
    const [pixelsPerMeter, setPixelsPerMeter] = useState<number | null>(null);
    const [origin, setOrigin] = useState<PixelCoords | null>(null);
    const [knownDistance, setKnownDistance] = useState<number>(10);

    const [tempPoint, setTempPoint] = useState<PixelCoords | null>(null);
    const [newPointName, setNewPointName] = useState('');
    const [isProcessing, setIsProcessing] = useState<boolean>(false);
    const [isPdfLibReady, setIsPdfLibReady] = useState<boolean>(false);
    const [pdfLibError, setPdfLibError] = useState<string | null>(null);
    
    const [mouseRealCoords, setMouseRealCoords] = useState<RealCoords | null>(null);
    const [mousePixelCoords, setMousePixelCoords] = useState<PixelCoords | null>(null);

    // Editing states
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editingName, setEditingName] = useState<string>('');
    const [editingAreaIndex, setEditingAreaIndex] = useState<number | null>(null);
    const [editingAreaName, setEditingAreaName] = useState<string>('');

    // Area definition state
    const [currentAreaPoints, setCurrentAreaPoints] = useState<Point[]>([]);
    const [newAreaName, setNewAreaName] = useState('');
    
    const [activeTab, setActiveTab] = useState<'points' | 'areas'>('points');

    // Compass state
    const [northRotation, setNorthRotation] = useState<number>(0);
    const [isRotatingCompass, setIsRotatingCompass] = useState<boolean>(false);
    
    // State for responsive image dimensions
    const [imageDimensions, setImageDimensions] = useState<{width: number, height: number} | null>(null);
    
    // PWA install prompt state
    const [installPrompt, setInstallPrompt] = useState<any>(null);


    const imageRef = useRef<HTMLImageElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const compassRef = useRef<HTMLDivElement>(null);

    // Effect to listen for the PWA install prompt
    useEffect(() => {
        const handleBeforeInstallPrompt = (e: Event) => {
            e.preventDefault();
            setInstallPrompt(e);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        };
    }, []);

    // Effect to dynamically load and configure the PDF.js library.
    useEffect(() => {
        const SCRIPT_URL = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js';
        const WORKER_URL = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

        if (window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
            setIsPdfLibReady(true);
            return;
        }

        const script = document.createElement('script');
        script.src = SCRIPT_URL;
        script.async = true;

        const handleLoad = () => {
            if (window.pdfjsLib) {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
                setIsPdfLibReady(true);
            } else {
                console.error('PDF.js script loaded but `window.pdfjsLib` is not defined.');
                setPdfLibError('Impossibile inizializzare la libreria PDF. Potrebbe essere bloccata dalla tua rete o dalle impostazioni del browser.');
            }
        };

        const handleError = () => {
            console.error('Failed to load the PDF.js script.');
            setPdfLibError('Impossibile caricare la libreria PDF. Controlla la tua connessione internet e gli ad-blocker, poi ricarica la pagina.');
        };

        script.addEventListener('load', handleLoad);
        script.addEventListener('error', handleError);

        document.body.appendChild(script);

        return () => {
            script.removeEventListener('load', handleLoad);
            script.removeEventListener('error', handleError);
        };
    }, []);
    
    // Effect for handling compass rotation
    useEffect(() => {
        const handleMouseMove = (e: globalThis.MouseEvent) => {
            if (!isRotatingCompass || !compassRef.current) return;

            const rect = compassRef.current.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const angleRad = Math.atan2(e.clientY - centerY, e.clientX - centerX);
            const angleDeg = angleRad * (180 / Math.PI) + 90; // +90 to align with North up

            setNorthRotation(angleDeg);
        };
        const handleMouseUp = () => {
             setIsRotatingCompass(false);
             document.body.style.cursor = 'default';
             document.body.style.userSelect = 'auto';
        };

        if (isRotatingCompass) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isRotatingCompass]);

    // Effect for handling window resize to keep SVG overlay aligned
    useEffect(() => {
        const handleResize = () => {
            if (imageRef.current) {
                const { width, height } = imageRef.current.getBoundingClientRect();
                setImageDimensions({ width, height });
            }
        };

        // Set initial dimensions
        if (imageSrc) {
            handleResize();
        }

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [imageSrc]); // Rerun this effect if the image source changes
    
    // Recalculate bearings for all points when north rotation changes
    useEffect(() => {
        if (points.length === 0 || !origin || !pixelsPerMeter) return;
        setPoints(currentPoints => currentPoints.map(p => {
             const { bearing } = calculateDistanceAndBearing(p.realCoords, northRotation);
             return { ...p, bearing };
        }));
    }, [northRotation, origin, pixelsPerMeter]);


    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        // Handle Image files
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                setImageSrc(e.target?.result as string);
                setAppState(AppState.CALIBRATE_START);
            };
            reader.readAsDataURL(file);
            return;
        }

        // Handle PDF files
        if (file.type === 'application/pdf') {
            setIsProcessing(true);
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    if (!window.pdfjsLib) {
                       throw new Error("PDF.js library is not loaded.");
                    }

                    const arrayBuffer = e.target?.result as ArrayBuffer;
                    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                    const page = await pdf.getPage(1); // Render the first page

                    const scale = 2.5; // Render at high resolution for clarity
                    const viewport = page.getViewport({ scale });
                    
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    if (!context) throw new Error("Could not get canvas context.");
                    
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;

                    await page.render({ canvasContext: context, viewport: viewport }).promise;
                    
                    setImageSrc(canvas.toDataURL('image/png'));
                    setAppState(AppState.CALIBRATE_START);
                } catch (error) {
                    console.error("Error processing PDF:", error);
                    alert("Impossibile caricare il PDF. Il file potrebbe essere corrotto o non supportato.");
                    handleReset();
                } finally {
                    setIsProcessing(false);
                }
            };
            reader.readAsArrayBuffer(file);
            return;
        }
        
        alert("Tipo di file non supportato. Carica un'immagine o un PDF.");
    };

    const getClickCoordinates = (e: MouseEvent<HTMLDivElement>): PixelCoords | null => {
        if (!imageRef.current) return null;
        const rect = imageRef.current.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        };
    };

    const calculateDistance = (p1: PixelCoords, p2: PixelCoords) => {
        return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    };

    const handleImageClick = (e: MouseEvent<HTMLDivElement>) => {
        const coords = getClickCoordinates(e);
        if (!coords) return;

        switch (appState) {
            case AppState.CALIBRATE_START:
                setCalibrationPoints([coords]);
                setAppState(AppState.CALIBRATE_END);
                break;
            case AppState.CALIBRATE_END:
                const secondPoint = coords;
                const firstPoint = calibrationPoints[0];
                const pixelDistance = calculateDistance(firstPoint, secondPoint);
                setPixelsPerMeter(pixelDistance / knownDistance);
                setCalibrationPoints(prev => [...prev, secondPoint]);
                setAppState(AppState.SET_ORIGIN);
                break;
            case AppState.SET_ORIGIN:
                setOrigin(coords);
                setAppState(AppState.READY);
                break;
            case AppState.READY:
                setTempPoint(coords);
                setNewPointName(`Punto ${points.length + 1}`);
                setAppState(AppState.NAMING_POINT);
                break;
            case AppState.DEFINING_AREA:
                const { realCoords, distance, bearing } = calculatePointData(coords);
                const newAreaPoint: Point = {
                    name: `V${currentAreaPoints.length + 1}`,
                    pixelCoords: coords,
                    realCoords,
                    distance,
                    bearing,
                };
                setCurrentAreaPoints(prev => [...prev, newAreaPoint]);
                break;
        }
    };
    
    const calculateRealCoords = (clickPos: PixelCoords): RealCoords => {
        if (!origin || !pixelsPerMeter) return { x: 0, y: 0 };
        const x_pixels = clickPos.x - origin.x;
        const y_pixels = origin.y - clickPos.y; // Y is inverted in screen coordinates
        return {
            x: x_pixels / pixelsPerMeter,
            y: y_pixels / pixelsPerMeter,
        };
    };

    const calculateDistanceAndBearing = (realCoords: RealCoords, rotation: number) => {
        const distance = Math.sqrt(realCoords.x ** 2 + realCoords.y ** 2);
        
        // Calculate bearing in degrees from North (positive Y axis)
        const angleRad = Math.atan2(realCoords.x, realCoords.y);
        let angleDeg = angleRad * (180 / Math.PI);
        
        // Adjust for compass rotation and normalize to 0-360
        let bearing = (angleDeg - rotation + 360) % 360;

        return { distance, bearing };
    };

    const calculatePointData = (pixelCoords: PixelCoords) => {
        const realCoords = calculateRealCoords(pixelCoords);
        const { distance, bearing } = calculateDistanceAndBearing(realCoords, northRotation);
        return { realCoords, distance, bearing };
    };
    
    const handleSavePoint = () => {
        if (!tempPoint || !newPointName.trim()) return;
        const { realCoords, distance, bearing } = calculatePointData(tempPoint);
        const newPoint: Point = {
            name: newPointName.trim(),
            pixelCoords: tempPoint,
            realCoords,
            distance,
            bearing,
        };
        setPoints([...points, newPoint]);
        handleCancelNaming();
    };

    const handleCancelNaming = () => {
        setTempPoint(null);
        setNewPointName('');
        setNewAreaName('');
        if (appState === AppState.NAMING_POINT) {
            setAppState(AppState.READY);
        }
        if(appState === AppState.NAMING_AREA) {
            // Don't discard points, just go back to defining
            setAppState(AppState.DEFINING_AREA);
        }
    };
    
    const handleDeletePoint = (index: number) => {
        setPoints(points.filter((_, i) => i !== index));
    };
    
    const handleDeleteArea = (index: number) => {
        setAreas(areas.filter((_, i) => i !== index));
    };

    const handleReset = () => {
        setImageSrc(null);
        setPoints([]);
        setAreas([]);
        setCalibrationPoints([]);
        setPixelsPerMeter(null);
        setOrigin(null);
        setTempPoint(null);
        setNewPointName('');
        setNewAreaName('');
        setCurrentAreaPoints([]);
        setKnownDistance(10);
        setEditingIndex(null);
        setEditingAreaIndex(null);
        setNorthRotation(0);
        setImageDimensions(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
        setAppState(AppState.UPLOAD_IMAGE);
    };

    const getInstruction = () => {
        switch (appState) {
            case AppState.UPLOAD_IMAGE:
                return { icon: <Upload size={20} />, title: "Carica File", description: "Seleziona una mappa, una planimetria o un'immagine/PDF satellitare per iniziare." };
            case AppState.CALIBRATE_START:
                return { icon: <Ruler size={20} />, title: "Passo 1: Calibra Scala", description: "Clicca sul punto INIZIALE di una distanza nota." };
            case AppState.CALIBRATE_END:
                return { icon: <Ruler size={20} />, title: "Passo 1: Calibra Scala", description: `Clicca sul punto FINALE della distanza di ${knownDistance}m.` };
            case AppState.SET_ORIGIN:
                return { icon: <Target size={20} />, title: "Passo 2: Imposta Origine", description: "Clicca sulla mappa per definire il punto di origine (0, 0)." };
            case AppState.READY:
                return { icon: <MapPin size={20} />, title: "Passo 3: Mappa e Orienta", description: "Clicca per marcare un punto, crea un'area o regola la bussola per impostare il Nord." };
            case AppState.NAMING_POINT:
                return { icon: <MapPin size={20} />, title: "Salva Punto", description: "Inserisci un nome per il tuo nuovo punto e salvalo." };
            case AppState.DEFINING_AREA:
                return { icon: <Shapes size={20} />, title: "Crea Area", description: "Clicca per aggiungere vertici. Minimo 3 per salvare." };
            case AppState.NAMING_AREA:
                 return { icon: <Shapes size={20} />, title: "Salva Area", description: "Inserisci un nome per la tua nuova area e salvala." };
            default:
                return { icon: <MousePointerClick size={20} />, title: "Caricamento...", description: "" };
        }
    };

    const handleImageMouseMove = (e: MouseEvent<HTMLDivElement>) => {
        const coords = getClickCoordinates(e);
        setMousePixelCoords(coords);

        if (appState < AppState.READY) {
             setMouseRealCoords(null);
             return;
        }

        if (coords) {
            setMouseRealCoords(calculateRealCoords(coords));
        }
    };
    
    const calculatePolygonArea = (coords: RealCoords[]): number => {
        let area = 0;
        const n = coords.length;
        if (n < 3) return 0;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            area += coords[i].x * coords[j].y;
            area -= coords[j].x * coords[i].y;
        }
        return Math.abs(area / 2);
    };

    const handleStartAreaMode = () => {
        setAppState(AppState.DEFINING_AREA);
        setCurrentAreaPoints([]);
    };

    const handleCancelAreaMode = () => {
        setAppState(AppState.READY);
        setCurrentAreaPoints([]);
    };

    const handleFinishArea = () => {
        if (currentAreaPoints.length < 3) {
            alert("Sono necessari almeno 3 punti per definire un'area.");
            return;
        }
        setNewAreaName(`Area ${areas.length + 1}`);
        setAppState(AppState.NAMING_AREA);
    };

    const handleSaveArea = () => {
        if (!newAreaName.trim() || currentAreaPoints.length < 3) return;

        const realCoordsForArea = currentAreaPoints.map(p => p.realCoords);
        const calculatedArea = calculatePolygonArea(realCoordsForArea);

        const newArea: Area = {
            name: newAreaName.trim(),
            points: [...currentAreaPoints],
            realArea: calculatedArea,
        };
        setAreas(prev => [...prev, newArea]);
        
        setCurrentAreaPoints([]);
        setNewAreaName('');
        setAppState(AppState.READY);
    };

    const handleExportCSV = () => {
        let csvContent = "data:text/csv;charset=utf-8,Nome,Distanza (m),Azimut (°)\n";
        points.forEach(p => {
            const row = `${p.name},${p.distance.toFixed(2)},${p.bearing.toFixed(2)}`;
            csvContent += row + "\n";
        });
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "punti_mappati.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };
    
    const handleExportPDF = async () => {
        if (points.length === 0 && areas.length === 0 || !imageSrc) {
            alert("Per favore, mappa alcuni punti o aree prima di esportare.");
            return;
        }
        
        setIsProcessing(true);

        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({
                orientation: 'p',
                unit: 'pt',
                format: 'a4'
            });

            // --- Create a new canvas with all overlays drawn on it ---
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const displayedImg = imageRef.current;
            if (!ctx || !displayedImg) {
                throw new Error("Canvas context or image ref is not available for PDF export.");
            }

            const img = new Image();
            img.src = imageSrc;
            await new Promise((resolve, reject) => { 
                img.onload = resolve;
                img.onerror = (err) => {
                    console.error("Image failed to load for PDF export.", err);
                    reject(new Error("L'immagine della mappa non può essere caricata per l'esportazione PDF."));
                }
            });

            const scale = img.naturalWidth / displayedImg.width;
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            
            // Helper to scale values from display size to natural image size
            const s = (value: number) => value * scale;

            // 1. Draw original image
            ctx.drawImage(img, 0, 0);

            // 2. Draw Areas
            areas.forEach(area => {
                ctx.fillStyle = 'rgba(0, 255, 255, 0.2)';
                ctx.strokeStyle = '#00FFFF';
                ctx.lineWidth = s(2);
                ctx.beginPath();
                area.points.forEach((p, i) => {
                    const x = s(p.pixelCoords.x);
                    const y = s(p.pixelCoords.y);
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                });
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            });

            // 3. Draw Origin and Cartesian Axes
            if (origin) {
                const ox = s(origin.x);
                const oy = s(origin.y);
                ctx.strokeStyle = '#FF00FF';
                ctx.lineWidth = s(1);

                // Axes
                ctx.beginPath();
                ctx.moveTo(0, oy); ctx.lineTo(canvas.width, oy); // X-axis
                ctx.moveTo(ox, 0); ctx.lineTo(ox, canvas.height); // Y-axis
                ctx.stroke();

                // Origin symbol
                ctx.lineWidth = s(2);
                ctx.beginPath();
                ctx.arc(ox, oy, s(8), 0, 2 * Math.PI);
                ctx.moveTo(ox - s(15), oy);
                ctx.lineTo(ox + s(15), oy);
                ctx.moveTo(ox, oy - s(15));
                ctx.lineTo(ox, oy + s(15));
                ctx.stroke();

                ctx.fillStyle = '#FF00FF';
                ctx.font = `bold ${s(14)}px sans-serif`;
                ctx.shadowColor = 'black';
                ctx.shadowBlur = s(6);
                ctx.fillText('PUNTO DI RIFERIMENTO', ox + s(18), oy + s(20));
                
                // Axis Labels
                ctx.fillText('X', canvas.width - s(15), oy - s(10));
                ctx.fillText('Y', ox + s(10), s(15));
                ctx.shadowBlur = 0;
            }

            // 4. Draw Points
            points.forEach(p => {
                const px = s(p.pixelCoords.x);
                const py = s(p.pixelCoords.y);
                
                ctx.beginPath();
                ctx.arc(px, py, s(5), 0, 2 * Math.PI);
                ctx.fillStyle = '#FF00FF';
                ctx.fill();
                ctx.strokeStyle = 'white';
                ctx.lineWidth = s(1);
                ctx.stroke();

                ctx.fillStyle = '#FF00FF';
                ctx.font = `bold ${s(12)}px sans-serif`;
                ctx.shadowColor = 'black';
                ctx.shadowBlur = s(6);
                ctx.fillText(p.name, px + s(8), py + s(4));
                ctx.shadowBlur = 0;
            });
            
            // 5. Draw Compass
             if (appState >= AppState.READY) {
                const compassRadius = 64; // 128px diameter from w-32, so radius is 64
                const compassMargin = 32; // from bottom-8/right-8
                
                const compassCenterX = displayedImg.width - compassRadius - compassMargin;
                const compassCenterY = displayedImg.height - compassRadius - compassMargin;

                const scx = s(compassCenterX);
                const scy = s(compassCenterY);
                const scr = s(compassRadius); // This is our '50' unit from the SVG viewBox
                
                ctx.save();
                ctx.translate(scx, scy);
                ctx.rotate(northRotation * Math.PI / 180);

                // --- Start new compass drawing logic based on SVG ---
                
                // Base circles
                ctx.beginPath();
                ctx.arc(0, 0, scr, 0, 2 * Math.PI);
                ctx.fillStyle = 'rgba(17, 24, 39, 0.8)';
                ctx.fill();

                ctx.strokeStyle = '#4b5563';
                ctx.lineWidth = s(1);
                ctx.beginPath();
                ctx.arc(0, 0, scr * 0.92, 0, 2 * Math.PI); // r=46
                ctx.stroke();

                // Intercardinal pointers
                ctx.fillStyle = '#9ca3af';
                // inter-pointer points="50,22 54,45 46,45"
                const interPoints = [
                    {x: 0, y: -0.56 * scr}, // 50,22 -> 0, -28 -> -28/50 = -0.56
                    {x: 0.08 * scr, y: -0.1 * scr}, // 54,45 -> 4, -5 -> 4/50=0.08, -5/50=-0.1
                    {x: -0.08 * scr, y: -0.1 * scr} // 46,45 -> -4, -5 -> -4/50=-0.08, -5/50=-0.1
                ];
                for (let i = 0; i < 4; i++) {
                    ctx.save();
                    ctx.rotate((45 + i * 90) * Math.PI / 180);
                    ctx.beginPath();
                    ctx.moveTo(interPoints[0].x, interPoints[0].y);
                    ctx.lineTo(interPoints[1].x, interPoints[1].y);
                    ctx.lineTo(interPoints[2].x, interPoints[2].y);
                    ctx.closePath();
                    ctx.fill();
                    ctx.restore();
                }

                // Cardinal pointers
                // main-pointer points="50,12 57,45 50,38 43,45"
                const mainPoints = [
                    {x: 0, y: -0.76 * scr},          // 50,12 -> 0,-38 -> -38/50 = -0.76
                    {x: 0.14 * scr, y: -0.1 * scr}, // 57,45 -> 7,-5 -> 7/50=0.14, -5/50=-0.1
                    {x: 0, y: -0.24 * scr},          // 50,38 -> 0,-12 -> -12/50 = -0.24
                    {x: -0.14 * scr, y: -0.1 * scr} // 43,45 -> -7,-5 -> -7/50=-0.14, -5/50=-0.1
                ];
                for (let i = 0; i < 4; i++) {
                    ctx.save();
                    ctx.rotate((i * 90) * Math.PI / 180);
                    ctx.fillStyle = i === 0 ? '#ef4444' : '#f9fafb';
                    ctx.beginPath();
                    ctx.moveTo(mainPoints[0].x, mainPoints[0].y);
                    ctx.lineTo(mainPoints[1].x, mainPoints[1].y);
                    ctx.lineTo(mainPoints[2].x, mainPoints[2].y);
                    ctx.lineTo(mainPoints[3].x, mainPoints[3].y);
                    ctx.closePath();
                    ctx.fill();
                    ctx.restore();
                }

                // Center circle
                ctx.fillStyle = '#111827';
                ctx.strokeStyle = '#4b5563';
                ctx.lineWidth = s(1);
                ctx.beginPath();
                ctx.arc(0, 0, scr * 0.12, 0, 2 * Math.PI); // r=6
                ctx.fill();
                ctx.stroke();

                // Labels
                const fontSize = scr * 0.2; // 10px in a 50px radius world
                ctx.font = `bold ${fontSize}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                ctx.fillStyle = '#ef4444';
                ctx.fillText('N', 0, -scr * 0.8); // y=10 -> -40 -> -40/50 = -0.8
                
                ctx.fillStyle = '#f9fafb';
                ctx.fillText('E', scr * 0.84, scr * 0.08); // x=92 -> 42 -> 0.84, y=54 -> 4 -> 0.08
                ctx.fillText('S', 0, scr * 0.88); // y=94 -> 44 -> 0.88
                ctx.fillText('W', -scr * 0.84, scr * 0.08); // x=8 -> -42 -> -0.84, y=54 -> 4 -> 0.08

                // --- End new compass drawing logic ---

                ctx.restore(); // Restore to before compass drawing
            }

            const annotatedImage = canvas.toDataURL('image/png');
            // --- End of canvas creation ---
            
            doc.text("Immagine Mappa Calibrata", 20, 30);
            
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const margin = 40;
            const availableWidth = pageWidth - margin * 2;
            let availableHeight = pageHeight - margin * 2;
             // Adjust available height for title
            availableHeight -= 30;

            const imgRatio = canvas.width / canvas.height;
            const pageRatio = availableWidth / availableHeight;
            let finalWidth, finalHeight;

            if (imgRatio > pageRatio) {
                finalWidth = availableWidth;
                finalHeight = finalWidth / imgRatio;
            } else {
                finalHeight = availableHeight;
                finalWidth = finalHeight * imgRatio;
            }

            const x = (pageWidth - finalWidth) / 2;
            const y = ((pageHeight - finalHeight) / 2) + 20;
            doc.addImage(annotatedImage, 'PNG', x, y, finalWidth, finalHeight);

            if (points.length > 0) {
                doc.addPage();
                doc.text("Punti Mappati", 20, 30);
                (doc as any).autoTable({
                    head: [["Nome", "Distanza dal Punto di Riferimento (m)", "Coordinate (X, Y)", "Azimut (°)"]],
                    body: points.map(p => [
                        p.name, 
                        p.distance.toFixed(2), 
                        `(${p.realCoords.x.toFixed(2)}, ${p.realCoords.y.toFixed(2)})`,
                        p.bearing.toFixed(2)
                    ]),
                    startY: 40,
                    margin: { left: 20, right: 20 },
                });
            }
            
            if (areas.length > 0) {
                 doc.addPage();
                 doc.text("Aree Mappate", 20, 30);
                 (doc as any).autoTable({
                    head: [["Nome", "Area (m²)"]],
                    body: areas.map(a => [a.name, a.realArea.toFixed(2)]),
                    startY: 40,
                    margin: { left: 20, right: 20 },
                });
            }

            doc.save('report_mappatura.pdf');
        } catch (error) {
            console.error("Failed to generate PDF:", error);
            alert(`Si è verificato un errore durante la creazione del PDF. Controlla la console per i dettagli.\n\nErrore: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setIsProcessing(false);
        }
    };
    
    const handleCompassMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsRotatingCompass(true);
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
    };

    const handleStartEditing = (index: number) => {
        setEditingIndex(index);
        setEditingName(points[index].name);
    };
    
    const handleCancelEditing = () => {
        setEditingIndex(null);
        setEditingName('');
    };

    const handleSaveEdit = () => {
        if (editingIndex === null || !editingName.trim()) return;
        const updatedPoints = [...points];
        updatedPoints[editingIndex].name = editingName.trim();
        setPoints(updatedPoints);
        setEditingIndex(null);
        setEditingName('');
    };

    const handleStartEditingArea = (index: number) => {
        setEditingAreaIndex(index);
        setEditingAreaName(areas[index].name);
    };

    const handleCancelEditingArea = () => {
        setEditingAreaIndex(null);
        setEditingAreaName('');
    };

    const handleSaveEditArea = () => {
        if (editingAreaIndex === null || !editingAreaName.trim()) return;
        const updatedAreas = [...areas];
        updatedAreas[editingAreaIndex].name = editingAreaName.trim();
        setAreas(updatedAreas);
        setEditingAreaIndex(null);
        setEditingAreaName('');
    };

    const handleInstallClick = () => {
        if (installPrompt) {
            installPrompt.prompt();
            installPrompt.userChoice.then((choiceResult: { outcome: 'accepted' | 'dismissed' }) => {
                if (choiceResult.outcome === 'accepted') {
                    console.log('User accepted the install prompt');
                } else {
                    console.log('User dismissed the install prompt');
                }
                setInstallPrompt(null);
            });
        }
    };

    const instruction = getInstruction();

    const renderNamingModal = () => {
        const isNamingPoint = appState === AppState.NAMING_POINT;
        const isNamingArea = appState === AppState.NAMING_AREA;
        if(!isNamingPoint && !isNamingArea) return null;

        const title = isNamingPoint ? "Dai un nome al tuo punto" : "Dai un nome alla tua area";
        const placeholder = isNamingPoint ? "es. Edificio A" : "es. Zona 1";
        const value = isNamingPoint ? newPointName : newAreaName;
        const onChange = isNamingPoint ? (e: React.ChangeEvent<HTMLInputElement>) => setNewPointName(e.target.value) : (e: React.ChangeEvent<HTMLInputElement>) => setNewAreaName(e.target.value);
        const onSave = isNamingPoint ? handleSavePoint : handleSaveArea;
        const onCancel = isNamingPoint ? handleCancelNaming : () => setAppState(AppState.DEFINING_AREA);

        return (
            <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-30" onClick={onCancel}>
                <div className="bg-gray-800 p-6 rounded-lg shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
                    <h3 className="text-xl font-bold mb-4 text-center text-blue-300">{title}</h3>
                    <input
                        type="text"
                        value={value}
                        onChange={onChange}
                        placeholder={placeholder}
                        className="w-full bg-gray-900 border border-gray-700 rounded-md p-2 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500 text-white"
                        autoFocus
                        onKeyDown={(e) => e.key === 'Enter' && onSave()}
                    />
                    <div className="flex justify-end gap-3">
                        <button onClick={onCancel} className="px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 transition-colors flex items-center gap-2">
                            <X size={16} /> Annulla
                        </button>
                        <button onClick={onSave} className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 transition-colors flex items-center gap-2">
                            <Save size={16} /> Salva
                        </button>
                    </div>
                </div>
            </div>
        );
    }
    
    const renderUploadScreen = () => {
        const getButtonText = () => {
            if (isProcessing) return 'In elaborazione...';
            if (pdfLibError) return 'Lettore PDF Fallito';
            if (!isPdfLibReady) return 'Inizializzazione Lettore PDF...';
            return 'Carica Immagine o PDF';
        };

        return (
            <div className="w-full h-full flex flex-col items-center justify-center bg-gray-800 p-8 text-center relative">
                {isProcessing && (
                    <div className="absolute inset-0 bg-gray-900/70 backdrop-blur-sm flex flex-col items-center justify-center z-10">
                        <svg className="animate-spin h-10 w-10 text-blue-400 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <p className="text-lg font-semibold text-gray-200">Elaborazione PDF in corso, attendere...</p>
                        <p className="text-sm text-gray-400">Sto rendendo la prima pagina come immagine.</p>
                    </div>
                )}
                <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-teal-300 mb-4">Mappatore e Calibratore di Immagini</h1>
                <p className="max-w-xl mb-8 text-gray-300">Carica un'immagine o un PDF (verrà usata la prima pagina) con una scala nota per misurare e registrare coordinate con precisione.</p>
                <input type="file" accept="image/*,application/pdf" onChange={handleFileUpload} className="hidden" ref={fileInputRef} />
                <button 
                    onClick={() => fileInputRef.current?.click()} 
                    className="px-6 py-3 rounded-md bg-blue-600 hover:bg-blue-500 transition-all transform hover:scale-105 text-lg font-semibold flex items-center gap-3 disabled:bg-gray-600 disabled:cursor-wait disabled:scale-100 disabled:bg-red-800" 
                    disabled={isProcessing || !isPdfLibReady || !!pdfLibError}
                >
                    <Upload size={22} /> {getButtonText()}
                </button>
                 {pdfLibError && <p className="text-red-400 mt-4 text-sm max-w-md">{pdfLibError}</p>}
            </div>
        );
    };

    return (
        <div className="min-h-screen max-h-screen flex flex-col bg-gray-900 font-sans text-gray-100 overflow-hidden">
            {!imageSrc ? renderUploadScreen() : (
                <>
                    <header className="flex justify-between items-center p-4 bg-gray-900/80 backdrop-blur-sm z-20 flex-shrink-0">
                        <h1 className="text-2xl md:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-teal-300">Mappatore Immagini</h1>
                        <div className="flex items-center gap-2">
                             {installPrompt && (
                                <button onClick={handleInstallClick} className="px-4 py-2 text-sm rounded-md bg-indigo-600 hover:bg-indigo-500 transition-colors flex items-center gap-2">
                                    <DownloadCloud size={16} /> Installa App
                                </button>
                            )}
                            <button onClick={handleReset} className="px-4 py-2 text-sm rounded-md bg-red-600 hover:bg-red-500 transition-colors flex items-center gap-2">
                                <RefreshCcw size={16} /> Ricomincia
                            </button>
                        </div>
                    </header>
                    <main className="flex-grow flex flex-col lg:flex-row relative min-h-0">
                        <div className="flex-grow flex flex-col min-h-0">
                            <div className="relative flex-grow bg-gray-800 flex items-center justify-center overflow-auto" onMouseMove={handleImageMouseMove} onMouseLeave={() => {setMouseRealCoords(null); setMousePixelCoords(null)}}>
                                <div className="relative cursor-crosshair" onClick={handleImageClick}>
                                    <img ref={imageRef} src={imageSrc} alt="Map for calibration" className="max-w-full max-h-full object-contain" onLoad={() => { if (imageRef.current) { const { width, height } = imageRef.current.getBoundingClientRect(); setImageDimensions({width, height})}}}/>
                                    <svg className="absolute top-0 left-0 w-full h-full pointer-events-none">
                                        {areas.map((area, index) => (
                                            <polygon key={`area-${index}`} points={area.points.map(p => `${p.pixelCoords.x},${p.pixelCoords.y}`).join(' ')} fill="rgba(0, 255, 255, 0.2)" stroke="#00FFFF" strokeWidth="2" />
                                        ))}

                                        {currentAreaPoints.map((p, i) => (
                                            <React.Fragment key={`current-area-point-${i}`}>
                                                <circle cx={p.pixelCoords.x} cy={p.pixelCoords.y} r="4" fill="#00FFFF" />
                                                {i > 0 && ( <line x1={currentAreaPoints[i-1].pixelCoords.x} y1={currentAreaPoints[i-1].pixelCoords.y} x2={p.pixelCoords.x} y2={p.pixelCoords.y} stroke="#00FFFF" strokeWidth="2" /> )}
                                            </React.Fragment>
                                        ))}
                                        {appState === AppState.DEFINING_AREA && currentAreaPoints.length > 0 && mousePixelCoords && (
                                            <line x1={currentAreaPoints[currentAreaPoints.length - 1].pixelCoords.x} y1={currentAreaPoints[currentAreaPoints.length - 1].pixelCoords.y} x2={mousePixelCoords.x} y2={mousePixelCoords.y} stroke="#00FFFF" strokeWidth="2" strokeDasharray="5,5" />
                                        )}
                                        
                                        {calibrationPoints.length > 0 && <circle cx={calibrationPoints[0].x} cy={calibrationPoints[0].y} r="5" fill="none" stroke="#FFD700" strokeWidth="2" />}
                                        {calibrationPoints.length > 1 && <>
                                            <circle cx={calibrationPoints[1].x} cy={calibrationPoints[1].y} r="5" fill="none" stroke="#FFD700" strokeWidth="2" />
                                            <line x1={calibrationPoints[0].x} y1={calibrationPoints[0].y} x2={calibrationPoints[1].x} y2={calibrationPoints[1].y} stroke="#FFD700" strokeWidth="2" strokeDasharray="5,5" />
                                        </>}

                                        {origin && pixelsPerMeter && imageDimensions && (
                                            <g id="cartesian-grid" stroke="#FF00FF" strokeWidth="1">
                                                {(() => {
                                                    const ticks = [];
                                                    const tickSize = 5; // length of the tick mark in pixels
                                                    const tickInterval = 10 * pixelsPerMeter;
                                                    const { width, height } = imageDimensions;

                                                    // Main Axes
                                                    ticks.push(<line key="x-axis" x1="0" y1={origin.y} x2={width} y2={origin.y} />);
                                                    ticks.push(<line key="y-axis" x1={origin.x} y1="0" x2={origin.x} y2={height} />);
                                                    
                                                    // Ticks on positive X-axis
                                                    for (let i = origin.x + tickInterval; i < width; i += tickInterval) {
                                                        ticks.push(<line key={`tick-x-pos-${i}`} x1={i} y1={origin.y - tickSize} x2={i} y2={origin.y + tickSize} />);
                                                    }
                                                    // Ticks on negative X-axis
                                                    for (let i = origin.x - tickInterval; i > 0; i -= tickInterval) {
                                                        ticks.push(<line key={`tick-x-neg-${i}`} x1={i} y1={origin.y - tickSize} x2={i} y2={origin.y + tickSize} />);
                                                    }
                                                    // Ticks on positive Y-axis (upwards)
                                                    for (let i = origin.y - tickInterval; i > 0; i -= tickInterval) {
                                                        ticks.push(<line key={`tick-y-pos-${i}`} x1={origin.x - tickSize} y1={i} x2={origin.x + tickSize} y2={i} />);
                                                    }
                                                    // Ticks on negative Y-axis (downwards)
                                                    for (let i = origin.y + tickInterval; i < height; i += tickInterval) {
                                                        ticks.push(<line key={`tick-y-neg-${i}`} x1={origin.x - tickSize} y1={i} x2={origin.x + tickSize} y2={i} />);
                                                    }
                                                    
                                                    // Axis Labels
                                                    ticks.push(<text key="x-label" x={width - 15} y={origin.y - 10} fill="#FF00FF" fontSize="14" fontWeight="bold">X</text>);
                                                    ticks.push(<text key="y-label" x={origin.x + 10} y={15} fill="#FF00FF" fontSize="14" fontWeight="bold">Y</text>);

                                                    return ticks;
                                                })()}
                                            </g>
                                        )}
                                        
                                        {origin && (
                                            <g>
                                                <circle cx={origin.x} cy={origin.y} r="8" fill="none" stroke="#FF00FF" strokeWidth="2" />
                                                <line x1={origin.x - 15} y1={origin.y} x2={origin.x + 15} y2={origin.y} stroke="#FF00FF" strokeWidth="2" />
                                                <line x1={origin.x} y1={origin.y - 15} x2={origin.x} y2={origin.y + 15} stroke="#FF00FF" strokeWidth="2" />
                                                <text x={origin.x + 18} y={origin.y + 20} fill="#FF00FF" fontSize="14" fontWeight="bold" style={{ textShadow: '0 0 3px black, 0 0 3px black' }}>PUNTO DI RIFERIMENTO</text>
                                            </g>
                                        )}
                                        
                                        {points.map((p, i) => (
                                            <g key={`point-group-${i}`}>
                                                <circle cx={p.pixelCoords.x} cy={p.pixelCoords.y} r="5" fill="#FF00FF" stroke="white" strokeWidth="1"/>
                                                <text x={p.pixelCoords.x + 8} y={p.pixelCoords.y + 4} fill="#FF00FF" fontSize="12" fontWeight="bold" style={{ textShadow: '0 0 3px black, 0 0 3px black' }} >{p.name}</text>
                                            </g>
                                        ))}
                                        
                                        {tempPoint && <circle cx={tempPoint.x} cy={tempPoint.y} r="6" fill="none" stroke="#00FFFF" strokeWidth="2" />}
                                    </svg>
                                </div>
                                {mouseRealCoords && (
                                    <div className="absolute bottom-4 right-4 bg-gray-900/80 backdrop-blur-md p-2 px-4 rounded-lg shadow-lg z-10 font-mono text-sm">
                                        X: {mouseRealCoords.x.toFixed(2)}m, Y: {mouseRealCoords.y.toFixed(2)}m
                                    </div>
                                )}
                                {appState >= AppState.READY && (
                                    <div 
                                        ref={compassRef}
                                        className={`absolute bottom-8 right-8 w-32 h-32 ${isRotatingCompass ? 'cursor-grabbing' : 'cursor-grab'}`}
                                        onMouseDown={handleCompassMouseDown}
                                        title="Clicca e trascina per impostare il Nord"
                                    >
                                        <div
                                            className="w-full h-full"
                                            style={{ 
                                                transform: `rotate(${northRotation}deg)`,
                                                transition: isRotatingCompass ? 'none' : 'transform 0.2s ease-out'
                                            }}
                                        >
                                            <svg viewBox="0 0 100 100" className="w-full h-full">
                                                <defs>
                                                    <polygon id="main-pointer" points="50,12 57,45 50,38 43,45" />
                                                    <polygon id="inter-pointer" points="50,22 54,45 46,45" />
                                                </defs>

                                                <circle cx="50" cy="50" r="50" fill="rgba(17, 24, 39, 0.8)" />
                                                <circle cx="50" cy="50" r="46" fill="none" stroke="#4b5563" strokeWidth="1" />

                                                <g fill="#9ca3af">
                                                    <use href="#inter-pointer" transform="rotate(45 50 50)" />
                                                    <use href="#inter-pointer" transform="rotate(135 50 50)" />
                                                    <use href="#inter-pointer" transform="rotate(225 50 50)" />
                                                    <use href="#inter-pointer" transform="rotate(315 50 50)" />
                                                </g>
                                                
                                                <g>
                                                    <use href="#main-pointer" fill="#ef4444" transform="rotate(0 50 50)" />
                                                    <use href="#main-pointer" fill="#f9fafb" transform="rotate(90 50 50)" />
                                                    <use href="#main-pointer" fill="#f9fafb" transform="rotate(180 50 50)" />
                                                    <use href="#main-pointer" fill="#f9fafb" transform="rotate(270 50 50)" />
                                                </g>

                                                <circle cx="50" cy="50" r="6" fill="#111827" stroke="#4b5563" strokeWidth="1"/>

                                                <g 
                                                    fill="#f9fafb" 
                                                    fontSize="10" 
                                                    fontWeight="bold" 
                                                    textAnchor="middle"
                                                >
                                                    <text x="50" y="10" fill="#ef4444">N</text>
                                                    <text x="92" y="54">E</text>
                                                    <text x="50" y="94">S</text>
                                                    <text x="8" y="54">W</text>
                                                </g>
                                            </svg>
                                        </div>
                                    </div>
                                )}
                                {renderNamingModal()}
                            </div>

                            <div className="flex-shrink-0 bg-gray-900/80 backdrop-blur-sm p-3 z-10 border-t border-gray-700">
                                <div className="flex items-center justify-between gap-4 w-full">
                                    <div className="flex items-center gap-4">
                                        <div className="p-2 rounded-full bg-blue-500/20 text-blue-300 flex-shrink-0">{instruction.icon}</div>
                                        <div>
                                            <h3 className="font-bold text-blue-300">{instruction.title}</h3>
                                            <p className="text-sm text-gray-300">{instruction.description}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        {(appState === AppState.CALIBRATE_START || appState === AppState.CALIBRATE_END) && (
                                            <>
                                                <label htmlFor="known-distance" className="text-sm font-semibold text-gray-300 whitespace-nowrap">Distanza Nota:</label>
                                                <input id="known-distance" type="number" value={knownDistance} onChange={(e) => setKnownDistance(parseFloat(e.target.value) || 0)} className="w-24 bg-gray-700 border border-gray-600 rounded-md p-1.5 text-center focus:outline-none focus:ring-2 focus:ring-blue-500 text-white"/>
                                                <span className="text-sm text-gray-400">metri</span>
                                            </>
                                        )}
                                        {appState === AppState.READY && (
                                            <button onClick={handleStartAreaMode} className="px-4 py-2 text-sm rounded-md bg-teal-600 hover:bg-teal-500 transition-colors flex items-center gap-2"><Shapes size={16}/>Crea Area</button>
                                        )}
                                        {appState === AppState.DEFINING_AREA && (
                                            <div className="flex gap-2">
                                                 <button onClick={handleCancelAreaMode} className="px-4 py-2 text-sm rounded-md bg-gray-600 hover:bg-gray-500 transition-colors flex items-center gap-2"><X size={16}/>Annulla</button>
                                                 <button onClick={handleFinishArea} disabled={currentAreaPoints.length < 3} className="px-4 py-2 text-sm rounded-md bg-blue-600 hover:bg-blue-500 transition-colors flex items-center gap-2 disabled:bg-gray-500 disabled:cursor-not-allowed"><Save size={16}/>Salva Area</button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex-shrink-0 lg:w-1/3 xl:w-1/4 bg-gray-800 p-4 h-1/3 lg:h-full flex flex-col">
                           <div className="flex border-b-2 border-gray-700 mb-4 flex-shrink-0">
                               <button onClick={() => setActiveTab('points')} className={`flex-1 p-3 font-semibold text-center transition-colors ${activeTab === 'points' ? 'bg-gray-700 text-blue-300' : 'text-gray-400 hover:bg-gray-700/50'}`}>Punti Salvati</button>
                               <button onClick={() => setActiveTab('areas')} className={`flex-1 p-3 font-semibold text-center transition-colors ${activeTab === 'areas' ? 'bg-gray-700 text-teal-300' : 'text-gray-400 hover:bg-gray-700/50'}`}>Aree Salvate</button>
                           </div>

                           <div className="flex justify-between items-center mb-4 flex-shrink-0">
                             <h2 className="text-2xl font-bold text-blue-300">{activeTab === 'points' ? 'Punti' : 'Aree'}</h2>
                              {(points.length > 0 || areas.length > 0) && (
                                <div className="flex items-center gap-2">
                                    <button onClick={handleExportCSV} className="px-3 py-1.5 text-sm rounded-md bg-teal-600 hover:bg-teal-500 transition-colors flex items-center gap-2">
                                        <Download size={16} /> CSV
                                    </button>
                                     <button onClick={handleExportPDF} className="px-3 py-1.5 text-sm rounded-md bg-sky-600 hover:bg-sky-500 transition-colors flex items-center gap-2 disabled:bg-gray-500 disabled:cursor-wait" disabled={isProcessing}>
                                        {isProcessing ? ( <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> ) : ( <FileText size={16} /> )}
                                        {isProcessing ? 'Creazione...' : 'PDF'}
                                    </button>
                                </div>
                              )}
                           </div>
                            {activeTab === 'points' && (points.length === 0 ? <p className="text-gray-400 flex-shrink-0">Nessun punto salvato.</p> :
                                <div className="overflow-auto -mx-4 px-4 flex-grow min-h-0">
                                    <table className="w-full text-left">
                                        <thead className="border-b-2 border-gray-700 sticky top-0 bg-gray-800">
                                            <tr><th className="p-2">Nome</th><th className="p-2" title="Distanza dal punto di origine">Distanza dal Punto di Riferimento (m)</th><th className="p-2">Coordinate (X, Y)</th><th className="p-2" title="Direzione in gradi rispetto al Nord">Azimut (°)</th><th className="p-2 text-right">Azioni</th></tr>
                                        </thead>
                                        <tbody>
                                            {points.map((point, index) => (
                                                <tr key={index} className="border-b border-gray-700/50 hover:bg-gray-700/50">
                                                    <td className="p-3 font-semibold">{editingIndex === index ? (<input type="text" value={editingName} onChange={(e) => setEditingName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()} className="bg-gray-900 border border-gray-600 rounded-md p-1 w-full" autoFocus />) : ( point.name )}</td>
                                                    <td className="p-3 font-mono">{point.distance.toFixed(2)}</td>
                                                    <td className="p-3 font-mono">({point.realCoords.x.toFixed(2)}, {point.realCoords.y.toFixed(2)})</td>
                                                    <td className="p-3 font-mono">{point.bearing.toFixed(2)}</td>
                                                    <td className="p-3 text-right">{editingIndex === index ? (<div className="flex gap-2 justify-end"><button onClick={handleSaveEdit} className="text-green-400 hover:text-green-300 p-1 rounded-full hover:bg-green-500/20"><Check size={18} /></button><button onClick={handleCancelEditing} className="text-gray-400 hover:text-gray-300 p-1 rounded-full hover:bg-gray-500/20"><X size={18} /></button></div>) : (<div className="flex gap-2 justify-end"><button onClick={() => handleStartEditing(index)} className="text-blue-400 hover:text-blue-300 p-1 rounded-full hover:bg-blue-500/20"><Pencil size={18} /></button><button onClick={() => handleDeletePoint(index)} className="text-red-400 hover:text-red-300 p-1 rounded-full hover:bg-red-500/20"><Trash2 size={18} /></button></div>)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                             {activeTab === 'areas' && (areas.length === 0 ? <p className="text-gray-400 flex-shrink-0">Nessuna area salvata.</p> :
                                <div className="overflow-auto -mx-4 px-4 flex-grow min-h-0">
                                    <table className="w-full text-left">
                                        <thead className="border-b-2 border-gray-700 sticky top-0 bg-gray-800">
                                            <tr><th className="p-2">Nome</th><th className="p-2">Area (m²)</th><th className="p-2 text-right">Azioni</th></tr>
                                        </thead>
                                        <tbody>
                                            {areas.map((area, index) => (
                                                <tr key={index} className="border-b border-gray-700/50 hover:bg-gray-700/50">
                                                    <td className="p-3 font-semibold">{editingAreaIndex === index ? (<input type="text" value={editingAreaName} onChange={(e) => setEditingAreaName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSaveEditArea()} className="bg-gray-900 border border-gray-600 rounded-md p-1 w-full" autoFocus />) : ( area.name )}</td>
                                                    <td className="p-3 font-mono">{area.realArea.toFixed(2)}</td>
                                                    <td className="p-3 text-right">{editingAreaIndex === index ? (<div className="flex gap-2 justify-end"><button onClick={handleSaveEditArea} className="text-green-400 hover:text-green-300 p-1 rounded-full hover:bg-green-500/20"><Check size={18} /></button><button onClick={handleCancelEditingArea} className="text-gray-400 hover:text-gray-300 p-1 rounded-full hover:bg-gray-500/20"><X size={18} /></button></div>) : (<div className="flex gap-2 justify-end"><button onClick={() => handleStartEditingArea(index)} className="text-blue-400 hover:text-blue-300 p-1 rounded-full hover:bg-blue-500/20"><Pencil size={18} /></button><button onClick={() => handleDeleteArea(index)} className="text-red-400 hover:text-red-300 p-1 rounded-full hover:bg-red-500/20"><Trash2 size={18} /></button></div>)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </main>
                </>
            )}
        </div>
    );
};