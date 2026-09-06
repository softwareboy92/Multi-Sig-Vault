import React, { useEffect, useRef } from "react";
import QRCodeLib from "qrcode";

interface QRCodeProps {
  value: string;
  size?: number;
}

/**
 * QR Code Component
 * Uses qrcode library to generate QR code as canvas
 */
export const QRCode: React.FC<QRCodeProps> = ({ value, size = 256 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !value) return;

    // Generate QR code
    QRCodeLib.toCanvas(
      canvasRef.current,
      value,
      {
        width: size,
        margin: 1,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
        errorCorrectionLevel: "M",
      },
      (error) => {
        if (error) {
          console.error("Failed to generate QR code:", error);
        }
      }
    );
  }, [value, size]);

  return (
    <div className="flex items-center justify-center">
      <canvas ref={canvasRef} />
    </div>
  );
};
