import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Camera, Loader2, ScanLine, X, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

export interface OcrResult {
  reading: number | null;
  serial: string | null;
  raw: string;
  imageData: string;
  serialMatch: "match" | "mismatch" | "unknown";
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCapture: (res: OcrResult) => void;
  expectedSerial?: string | null;
}

function normalize(s: string): string {
  return s.toUpperCase().replace(/[-\s]/g, "");
}

export function MeterCamera({ open, onClose, onCapture, expectedSerial }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        if (typeof navigator === "undefined" || !navigator.mediaDevices) {
          toast.error("الكاميرا غير مدعومة في هذا المتصفح");
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } }, audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setReady(true);
        }
      } catch (e) {
        console.error(e);
        toast.error("تعذّر فتح الكاميرا. تحقق من الأذونات.");
      }
    })();
    return () => {
      cancelled = true;
      setReady(false); setBusy(false); setProgress(0);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [open]);

  async function capture() {
    if (!videoRef.current || !canvasRef.current) return;
    setBusy(true); setProgress(0);
    try {
      const v = videoRef.current;
      const c = canvasRef.current;
      const w = v.videoWidth || 640;
      const h = v.videoHeight || 480;
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("no ctx");
      ctx.drawImage(v, 0, 0, w, h);
      const imageData = c.toDataURL("image/jpeg", 0.75);

      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === "recognizing text") setProgress(Math.round(m.progress * 100));
        },
      });
      await worker.setParameters({ tessedit_char_whitelist: "0123456789WE-" });
      const { data } = await worker.recognize(c);
      await worker.terminate();

      const raw = (data.text || "").trim();
      const serialMatch = raw.match(/[WE]-?\d{3,5}/i);
      const numMatches = raw.match(/\d{2,7}/g) || [];
      const longest = numMatches.sort((a, b) => b.length - a.length)[0];
      const reading = longest ? parseInt(longest, 10) : null;
      const serial = serialMatch ? serialMatch[0].toUpperCase() : null;

      let match: OcrResult["serialMatch"] = "unknown";
      if (expectedSerial && serial) {
        match = normalize(serial) === normalize(expectedSerial) ? "match" : "mismatch";
      }

      onCapture({ reading, serial, raw, imageData, serialMatch: match });
      if (reading == null) toast.warning("لم يُتعرَّف على أرقام واضحة — أعد المحاولة");
    } catch (e) {
      console.error(e);
      toast.error("فشل التعرف على الصورة");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="w-4 h-4" /> تصوير العداد + التحقق البصري
          </DialogTitle>
        </DialogHeader>
        {expectedSerial && (
          <div className="text-xs bg-muted/40 border rounded-md p-2 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-primary" />
            <span>الرقم المتوقع للعداد: <span className="font-mono font-semibold" dir="ltr">{expectedSerial}</span></span>
          </div>
        )}
        <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
          <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-16 border-2 border-yellow-400/80 rounded-md pointer-events-none" />
          {busy && (
            <div className="absolute inset-0 grid place-items-center bg-black/60 text-white text-sm gap-2">
              <Loader2 className="w-6 h-6 animate-spin" />
              <div>جارٍ التعرف على الأرقام… {progress}%</div>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">وجّه الكاميرا نحو شاشة العداد بحيث تكون الأرقام ورقم العداد داخل الإطار.</p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}><X className="w-4 h-4 ms-1" /> إلغاء</Button>
          <Button onClick={capture} disabled={!ready || busy}>
            <ScanLine className="w-4 h-4 ms-1" /> التقاط وقراءة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
