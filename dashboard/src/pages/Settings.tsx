import { useState, useEffect, useRef } from "react";
import { api } from "../api/client";

export default function Settings() {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.authorPhoto().then(setPhotoUrl).catch(() => {});
  }, []);

  // Revoke previous blob URL whenever photoUrl changes or on unmount
  const prevUrlRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevUrlRef.current) {
      URL.revokeObjectURL(prevUrlRef.current);
    }
    prevUrlRef.current = photoUrl;
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!["image/jpeg", "image/png"].includes(file.type)) {
      alert("Please upload a JPEG or PNG file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert("File too large. Max 5MB.");
      return;
    }

    setUploading(true);
    try {
      await api.uploadAuthorPhoto(file);
      const url = await api.authorPhoto();
      setPhotoUrl(url);
    } catch {
      alert("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    await api.deleteAuthorPhoto();
    setPhotoUrl(null);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Settings</h2>

      <div className="bg-surface-1 border border-border rounded-lg p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-text-primary mb-1">
            Author Reference Photo
          </h3>
          <p className="text-xs text-text-muted">
            Upload a photo of yourself so the AI can identify you in post
            images. Used for image classification — helps determine which posts
            feature you vs. other people.
          </p>
        </div>

        {photoUrl ? (
          <div className="flex items-center gap-4">
            <img
              src={photoUrl}
              alt="Author reference"
              className="w-24 h-24 rounded-lg object-cover border border-border"
            />
            <div className="flex flex-col gap-2">
              <button
                onClick={() => fileInput.current?.click()}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-surface-2 text-text-primary hover:bg-surface-3 transition-colors"
              >
                Replace
              </button>
              <button
                onClick={handleDelete}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-negative hover:bg-negative/10 transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            className="px-4 py-2 rounded-md text-sm font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "Upload Photo"}
          </button>
        )}

        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png"
          onChange={handleUpload}
          className="hidden"
        />
      </div>
    </div>
  );
}
