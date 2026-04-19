import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, Plus, Trash2 } from 'lucide-react';

export default function LibraryManager() {
  const [library, setLibrary] = useState<any[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newBook, setNewBook] = useState({ title: '', author: '' });

  useEffect(() => {
    fetch('http://localhost:3001/api/library')
      .then(r => r.json())
      .then(data => setLibrary(Array.isArray(data) ? data : []))
      .catch(err => console.error("Could not fetch library", err));
  }, []);

  const handleSave = async (updatedLibrary: any[]) => {
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

  const addBook = () => {
    if (!newBook.title.trim() || !newBook.author.trim()) return;
    const updated = [...library, { ...newBook }];
    handleSave(updated);
    setNewBook({ title: '', author: '' });
    setIsAdding(false);
  };

  const removeBook = (titleToRemove: string) => {
    const updated = library.filter(b => b.title !== titleToRemove);
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
          className="flex items-center gap-2 bg-primary hover:bg-primaryHover text-white px-6 py-3 rounded-xl font-bold transition-all shadow-lg shadow-primary/30 active:scale-95"
        >
          <Plus size={20} className="stroke-[3px]" />
          Add to Library
        </button>
      </div>

      {isAdding && (
         <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white border border-primary/30 rounded-3xl p-6 shadow-md max-w-2xl flex flex-col gap-4">
           <h3 className="font-bold text-textMain text-lg">Add New Book</h3>
           <div className="grid grid-cols-2 gap-4">
             <div>
                <label className="text-xs font-bold text-textMain mb-1 block">Title</label>
                <input 
                  type="text" 
                  value={newBook.title}
                  onChange={e => setNewBook({...newBook, title: e.target.value})}
                  className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-textMain font-medium focus:outline-none focus:ring-2 focus:ring-primary/50" 
                  placeholder="e.g. Moby-Dick"
                />
             </div>
             <div>
                <label className="text-xs font-bold text-textMain mb-1 block">Author</label>
                <input 
                  type="text" 
                  value={newBook.author}
                  onChange={e => setNewBook({...newBook, author: e.target.value})}
                  className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-textMain font-medium focus:outline-none focus:ring-2 focus:ring-primary/50" 
                  placeholder="e.g. Herman Melville"
                />
             </div>
           </div>
           <div className="flex justify-end gap-3 mt-2">
             <button onClick={() => setIsAdding(false)} className="px-5 py-2 font-bold text-textMuted hover:text-textMain">Cancel</button>
             <button onClick={addBook} className="px-5 py-2 font-bold text-white bg-textMain rounded-xl shadow-sm hover:bg-black transition-colors">Save Book</button>
           </div>
         </motion.div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {library.map((book, idx) => (
          <motion.div key={idx} className="bg-white border border-[#D9CFC4] rounded-2xl p-6 flex flex-col shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 text-primary">
                <BookOpen size={24} />
              </div>
              <button 
                onClick={() => removeBook(book.title)}
                className="p-2 text-textMuted hover:text-[#D96C3B] hover:bg-[#D96C3B]/10 rounded-lg transition-colors"
                title="Remove from Global Library"
              >
                <Trash2 size={18} />
              </button>
            </div>
            
            <div className="mt-auto pt-2">
              <h3 className="text-xl font-bold text-textMain leading-tight">{book.title}</h3>
              <p className="text-textMuted font-medium text-sm mt-1">{book.author}</p>
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
