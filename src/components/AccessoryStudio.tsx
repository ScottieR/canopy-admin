import { useState, useRef } from 'react';
import { UploadCloud, Sparkles, Loader2, ArrowRight } from 'lucide-react';

export function AccessoryStudio({ onAddAccessory }: { onAddAccessory: (path: string) => void }) {
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<any[]>([]);
  const [bakingStates, setBakingStates] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    try {
      const res = await fetch("http://localhost:3001/api/generate-accessories-2d", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt })
      });
      const data = await res.json();
      if (data.items) {
        setGeneratedImages(prev => [...data.items, ...prev]);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to generate options.");
    } finally {
      setIsGenerating(false);
    }
  };

  const bakeTo3D = async (url: string) => {
    setBakingStates(prev => ({ ...prev, [url]: "starting" }));
    try {
      const res = await fetch("http://localhost:3001/api/meshy-task", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: url })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      const taskId = data.taskId;
      setBakingStates(prev => ({ ...prev, [url]: "meshing" }));
      
      // Poll
      const poll = setInterval(async () => {
        const checkRes = await fetch(`http://localhost:3001/api/meshy-check/${taskId}`);
        const checkData = await checkRes.json();
        if (checkData.status === "SUCCEEDED") {
          clearInterval(poll);
          setBakingStates(prev => ({ ...prev, [url]: "done" }));
          onAddAccessory(checkData.glbPath);
        } else if (checkData.status === "FAILED") {
          clearInterval(poll);
          setBakingStates(prev => ({ ...prev, [url]: "failed" }));
        }
      }, 3000);
      
    } catch (e: any) {
      alert("Failed to bake to 3D: " + e.message);
      setBakingStates(prev => ({ ...prev, [url]: "failed" }));
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const formData = new FormData();
    for (let i = 0; i < e.target.files.length; i++) {
       formData.append("files", e.target.files[i]);
    }
    
    try {
      const res = await fetch("http://localhost:3001/api/upload-bulk", {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (data.success && data.files) {
        data.files.forEach((f: string) => onAddAccessory(f));
        alert("Successfully uploaded files to accessory catalog!");
      }
    } catch (error) {
      console.error(error);
      alert("Upload failed.");
    }
  };

  return (
    <div className="space-y-6">
      
      {/* NANO BANANA / IMAGE GEN */}
      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={18} className="text-primary" />
          <h4 className="text-textMain font-bold text-sm">Nano Banana Studio</h4>
        </div>
        <p className="text-xs text-textMuted mb-4">Prompt the AI to create fresh accessories. Examples: "green visor", "red top hat".</p>
        
        <div className="flex gap-2">
          <input 
            type="text" 
            value={prompt} 
            onChange={(e) => setPrompt(e.target.value)} 
            placeholder="A wizard staff..." 
            className="flex-1 bg-white border border-border rounded-lg px-3 text-sm focus:outline-none"
            onKeyDown={e => e.key === "Enter" && handleGenerate()}
          />
          <button 
            onClick={handleGenerate}
            disabled={isGenerating || !prompt}
            className="bg-primary text-white font-bold text-sm px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {isGenerating ? <Loader2 size={16} className="animate-spin" /> : "Generate"}
          </button>
        </div>
      </div>

      {/* GENERATED THUMBNAILS */}
      {generatedImages.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {generatedImages.map((img, i) => (
            <div key={i} className="relative bg-white border border-border rounded-xl overflow-hidden group">
              <img src={img.url} alt={img.prompt} className="w-full aspect-square object-cover" />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-4">
                <p className="text-white text-xs text-center mb-3 line-clamp-2">{img.prompt}</p>
                <button 
                  onClick={() => bakeTo3D(img.url)}
                  disabled={!!bakingStates[img.url]}
                  className="bg-white text-black font-bold text-xs px-3 py-1.5 rounded-md w-full flex items-center justify-center gap-2"
                >
                  {bakingStates[img.url] === "starting" ? "Sending..." :
                   bakingStates[img.url] === "meshing" ? <><Loader2 size={12} className="animate-spin" /> Meshy Baking...</> :
                   bakingStates[img.url] === "done" ? "Added to Scene!" :
                   <>Bake to 3D <ArrowRight size={12} /></>}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* BULK UPLOAD */}
      <div className="border border-dashed border-border rounded-2xl p-6 text-center hover:bg-black/5 transition-colors cursor-pointer" onClick={() => fileInputRef.current?.click()}>
        <UploadCloud size={24} className="text-textMuted mx-auto mb-2" />
        <h4 className="text-textMain font-bold text-sm">Bulk Sliced Upload</h4>
        <p className="text-xs text-textMuted mt-1">Drag and drop or click to upload baked asset sets directly.</p>
        <input type="file" ref={fileInputRef} multiple className="hidden" accept="image/png, image/jpeg, .glb" onChange={handleFileUpload} />
      </div>

    </div>
  );
}
