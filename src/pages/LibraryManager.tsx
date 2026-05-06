import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, Plus, Trash2 } from 'lucide-react';
import BookSearch from '../components/BookSearch';
import type { BookSchema } from '../components/BookSearch';

export default function LibraryManager() {
  const [library, setLibrary] = useState<BookSchema[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterAgent, setFilterAgent] = useState("All");

  const uniqueAgents = Array.from(new Set(library.flatMap(b => b.recommendedAgents || []))).sort();

  const filteredLibrary = library.filter(book => {
    const matchesSearch = (book.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (book.author || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (book.subjects || []).some(s => s.toLowerCase().includes(searchQuery.toLowerCase())));
    const matchesAgent = filterAgent === 'All' || (book.recommendedAgents || []).includes(filterAgent);
    return matchesSearch && matchesAgent;
  });

  useEffect(() => {
    fetch('/api/library')
      .then(r => r.json())
      .then(data => setLibrary(Array.isArray(data) ? data : []))
      .catch(err => console.error("Could not fetch library", err));
  }, []);

  const handleSave = async (updatedLibrary: BookSchema[]) => {
    try {
      await fetch('/api/library', {
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

      <div className="flex gap-4 items-center bg-white p-2 rounded-2xl border border-border shadow-sm w-full max-w-2xl mb-2">
        <input 
          type="text" 
          placeholder="Search by title, author, or subject..." 
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="flex-1 px-4 py-2 outline-none text-textMain bg-transparent"
        />
        <select 
          value={filterAgent}
          onChange={e => setFilterAgent(e.target.value)}
          className="px-4 py-2 border-l border-border outline-none text-textMain bg-transparent font-medium cursor-pointer max-w-[200px] truncate"
        >
          <option value="All">All Agents</option>
          {uniqueAgents.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-3xl border border-border shadow-sm overflow-hidden mt-6">
        <table className="w-full text-left">
          <thead className="bg-backgroundAlt border-b border-border">
             <tr>
                <th className="px-6 py-4 font-bold text-textMuted text-xs uppercase tracking-wider">Book</th>
                <th className="px-6 py-4 font-bold text-textMuted text-xs uppercase tracking-wider">Description</th>
                <th className="px-6 py-4 font-bold text-textMuted text-xs uppercase tracking-wider">Agents</th>
                <th className="px-6 py-4 font-bold text-textMuted text-xs uppercase tracking-wider text-right">Actions</th>
             </tr>
          </thead>
          <tbody className="divide-y divide-border">
             {filteredLibrary.map(book => (
               <motion.tr 
                 key={book.key} 
                 initial={{ opacity: 0 }}
                 animate={{ opacity: 1 }}
                 className="hover:bg-backgroundAlt/50 transition-colors group"
               >
                  <td className="px-6 py-4 w-1/3">
                     <div className="flex items-start gap-4">
                       <div className="w-12 h-16 bg-background rounded-md border border-border flex items-center justify-center overflow-hidden shrink-0">
                         {book.coverUrl ? (
                           <img src={book.coverUrl} alt="Cover" className="w-full h-full object-cover" />
                         ) : (
                           <BookOpen size={20} className="text-textMuted/40" />
                         )}
                       </div>
                       <div>
                         <h3 className="font-extrabold text-textMain text-md max-w-[200px] line-clamp-2" title={book.title}>{book.title}</h3>
                         <p className="text-xs font-medium text-textMuted mt-1">{book.author}</p>
                       </div>
                     </div>
                  </td>
                  <td className="px-6 py-4 max-w-sm w-1/3">
                    <p className="text-xs text-textMuted line-clamp-3 mb-2" title={book.description}>{book.description || 'No description available.'}</p>
                    <div className="flex flex-wrap gap-1">
                       {book.subjects?.slice(0, 3).map(s => (
                         <span key={s} className="text-[10px] font-bold bg-background text-textMuted px-2 py-0.5 rounded-full border border-border">{s}</span>
                       ))}
                    </div>
                  </td>
                  <td className="px-6 py-4 w-1/4">
                    <div className="flex flex-wrap gap-1 items-center">
                      {book.recommendedAgents && book.recommendedAgents.length > 0 ? (
                        book.recommendedAgents.map(a => (
                          <span key={a} className="text-[10px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded border border-primary/20">
                            {a}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] italic text-textMuted">None</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right w-[10%]">
                    <button 
                      onClick={() => removeBook(book.key)}
                      className="p-2 text-textMuted hover:text-[#D96C3B] hover:bg-[#D96C3B]/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100 inline-block"
                      title="Remove from Global Library"
                    >
                      <Trash2 size={18} />
                    </button>
                  </td>
               </motion.tr>
             ))}
          </tbody>
        </table>
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
