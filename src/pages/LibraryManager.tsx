import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, Plus, Trash2, Tag } from 'lucide-react';
import BookSearch from '../components/BookSearch';
import type { BookSchema } from '../components/BookSearch';

export default function LibraryManager() {
  const [library, setLibrary] = useState<BookSchema[]>([]);
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    fetch('http://localhost:3001/api/library')
      .then(r => r.json())
      .then(data => setLibrary(Array.isArray(data) ? data : []))
      .catch(err => console.error("Could not fetch library", err));
  }, []);

  const handleSave = async (updatedLibrary: BookSchema[]) => {
    try {
      await fetch('http://localhost:3001/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedLibrary)
      });
      setLibrary(updatedLibrary);
    } catch(err) {
      console.error(err);
      alert("Failed to save library.");
    }
  };

  const handleAddBooks = (newBooks: BookSchema[]) => {
    // avoid duplicates by checking keys
    const existingKeys = new Set(library.map(b => b.key));
    const toAdd = newBooks.filter(b => !existingKeys.has(b.key));
    const updated = [...library, ...toAdd];
    handleSave(updated);
    setIsAdding(false);
  };

  const removeBook = (keyToRemove: string) => {
    const updated = library.filter(b => b.key !== keyToRemove);
    handleSave(updated);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-10">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-textMain mb-2">Book Library</h1>
          <p className="text-textMuted font-medium text-lg">Curated pool of public domain books that users can assign to their agents.</p>
        </div>
        <button 
          onClick={() => setIsAdding(!isAdding)}
          className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all shadow-lg active:scale-95 ${isAdding ? 'bg-outline-variant text-textMain shadow-none' : 'bg-primary hover:bg-primaryHover text-white shadow-primary/30'}`}
        >
          {isAdding ? "Cancel Search" : <><Plus size={20} className="stroke-[3px]" /> Add to Library</>}
        </button>
      </div>

      {isAdding && (
         <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-5xl">
            <BookSearch onAdd={handleAddBooks} />
         </motion.div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {library.map((book) => (
          <motion.div layout key={book.key} className="bg-white border border-[#D9CFC4] rounded-3xl p-5 flex flex-col shadow-sm hover:shadow-md transition-all group hover:border-primary/30">
            <div className="flex items-start justify-between mb-4">
              <div className="w-16 h-20 bg-background rounded-lg border border-border flex items-center justify-center overflow-hidden shrink-0">
                {book.coverUrl ? (
                  <img src={book.coverUrl} alt="Cover" className="w-full h-full object-cover" />
                ) : (
                  <BookOpen size={24} className="text-textMuted/40" />
                )}
              </div>
              <button 
                onClick={() => removeBook(book.key)}
                className="p-2 text-textMuted hover:text-[#D96C3B] hover:bg-[#D96C3B]/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                title="Remove from Global Library"
              >
                <Trash2 size={18} />
              </button>
            </div>
            
            <div className="flex-1 flex flex-col">
              <h3 className="text-lg font-bold text-textMain leading-tight line-clamp-2" title={book.title}>{book.title}</h3>
              <p className="text-textMuted font-medium text-sm mt-1 mb-3">{book.author}</p>
              
              {book.description && (
                <div className="relative group/desc">
                  <p className="text-xs text-textMuted line-clamp-2 mb-3 bg-background p-2 rounded-lg border border-border">
                    {book.description}
                  </p>
                  <div className="absolute hidden group-hover/desc:block z-10 w-full max-h-48 overflow-y-auto bg-surface border border-outline-variant rounded-xl p-3 shadow-xl top-full mt-1 text-xs text-textMain">
                    {book.description}
                  </div>
                </div>
              )}
              
              <div className="mt-auto pt-2 border-t border-border/50">
                <div className="flex flex-wrap gap-1 mb-2">
                   {book.subjects?.slice(0, 3).map(s => (
                     <span key={s} className="text-[10px] font-bold bg-background text-textMuted px-2 py-0.5 rounded-full border border-border">{s}</span>
                   ))}
                </div>
                
                <div className="flex flex-wrap gap-1 items-center">
                  <Tag size={12} className="text-primary mr-1" />
                  {book.recommendedAgents && book.recommendedAgents.length > 0 ? (
                    book.recommendedAgents.map(a => (
                      <span key={a} className="text-[10px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded border border-primary/20">
                        {a}
                      </span>
                    ))
                  ) : (
                    <span className="text-[10px] italic text-textMuted">No agents assigned</span>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
      
      {library.length === 0 && (
         <div className="text-center py-20 bg-white/50 rounded-3xl border border-dashed border-[#D9CFC4]">
             <BookOpen size={48} className="mx-auto text-textMuted/50 mb-4" />
             <p className="text-textMuted font-bold text-lg">No books currently in the library.</p>
         </div>
      )}
    </motion.div>
  );
}
