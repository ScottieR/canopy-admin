import { useState } from 'react';
import { Search, Loader2, CheckSquare, Square, BookOpen, Plus } from 'lucide-react';

export interface BookSchema {
  key: string;
  title: string;
  author: string;
  coverUrl: string;
  description: string;
  subjects: string[];
  recommendedAgents: string[];
}

export default function BookSearch({ onAdd }: { onAdd: (books: BookSchema[]) => void }) {
  const [query, setQuery] = useState('');
  const [subject, setSubject] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [isSearching, setIsSearching] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

  const handleSearch = async () => {
    if (!query.trim() && !subject.trim()) return;
    setIsSearching(true);
    setResults([]);
    setSelectedKeys(new Set());
    
    try {
      let url = 'https://openlibrary.org/search.json?';
      const params = new URLSearchParams();
      if (query) params.append('q', query);
      if (subject) params.append('subject', subject);
      params.append('limit', '12');
      
      const res = await fetch(url + params.toString());
      const data = await res.json();
      setResults(data.docs || []);
    } catch (e) {
      console.error(e);
      alert('Failed to search books.');
    }
    setIsSearching(false);
  };

  const handleToggleSelect = (key: string) => {
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedKeys(next);
  };

  const handleAddSelected = async () => {
    if (selectedKeys.size === 0) return;
    setIsAdding(true);
    
    const booksToAdd: BookSchema[] = [];
    
    for (const key of Array.from(selectedKeys)) {
      const doc = results.find(r => r.key === key);
      if (!doc) continue;
      
      let description = '';
      try {
        const res = await fetch(`https://openlibrary.org${key}.json`);
        const data = await res.json();
        if (typeof data.description === 'string') {
          description = data.description;
        } else if (data.description && data.description.value) {
          description = data.description.value;
        }
      } catch (e) {
        console.warn('Could not fetch description for', key);
      }
      
      booksToAdd.push({
        key: doc.key,
        title: doc.title,
        author: doc.author_name ? doc.author_name[0] : 'Unknown Author',
        coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : '',
        description,
        subjects: doc.subject ? doc.subject.slice(0, 5) : [],
        recommendedAgents: [] // Default empty, parent component can mutate
      });
    }
    
    setIsAdding(false);
    onAdd(booksToAdd);
  };

  return (
    <div className="bg-white border border-[#D9CFC4] rounded-2xl p-6 shadow-sm">
      <div className="flex gap-3 mb-6">
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" />
          <input 
            type="text" 
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Search by title, author, or keyword..."
            className="w-full bg-background border border-border rounded-xl pl-10 pr-4 py-3 text-textMain font-medium focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <div className="w-1/3">
          <input 
            type="text" 
            value={subject}
            onChange={e => setSubject(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Subject (e.g. Science)"
            className="w-full bg-background border border-border rounded-xl px-4 py-3 text-textMain font-medium focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <button 
          onClick={handleSearch}
          disabled={isSearching}
          className="bg-textMain hover:bg-black text-white px-6 rounded-xl font-bold transition-colors disabled:opacity-50"
        >
          {isSearching ? <Loader2 size={20} className="animate-spin" /> : 'Search'}
        </button>
      </div>

      {results.length > 0 && (
        <div className="space-y-4">
          <div className="flex justify-between items-center mb-2 border-b border-border pb-2">
             <h4 className="font-bold text-textMain text-sm">Search Results</h4>
             <button 
               onClick={handleAddSelected}
               disabled={selectedKeys.size === 0 || isAdding}
               className="flex items-center gap-2 bg-primary hover:bg-primaryHover text-white px-4 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-50"
             >
               {isAdding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
               Add Selected ({selectedKeys.size})
             </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-[500px] overflow-y-auto pr-2">
            {results.map(doc => {
              const isSelected = selectedKeys.has(doc.key);
              return (
                <div 
                  key={doc.key} 
                  onClick={() => handleToggleSelect(doc.key)}
                  className={`p-3 rounded-xl border-2 cursor-pointer transition-all ${isSelected ? 'border-primary bg-primary/5' : 'border-[#D9CFC4] bg-white hover:border-primary/40'}`}
                >
                  <div className="flex justify-between items-start mb-2">
                     {isSelected ? <CheckSquare size={20} className="text-primary" /> : <Square size={20} className="text-textMuted" />}
                  </div>
                  <div className="h-32 bg-background flex items-center justify-center rounded-lg overflow-hidden mb-3 border border-border">
                    {doc.cover_i ? (
                      <img src={`https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`} alt="Cover" className="h-full object-contain" />
                    ) : (
                      <BookOpen size={32} className="text-textMuted/30" />
                    )}
                  </div>
                  <h5 className="font-bold text-textMain text-sm leading-tight line-clamp-2" title={doc.title}>{doc.title}</h5>
                  <p className="text-xs font-medium text-textMuted mt-1 line-clamp-1">{doc.author_name ? doc.author_name[0] : 'Unknown'}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
      
      {results.length === 0 && !isSearching && query && (
         <div className="text-center py-10 text-textMuted font-medium">No results found.</div>
      )}
    </div>
  );
}
