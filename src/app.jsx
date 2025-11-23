import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Folder, 
  File, 
  FileText, 
  Image as ImageIcon, 
  Music, 
  Video, 
  MoreVertical, 
  Download, 
  Trash2, 
  Plus, 
  Search, 
  Home, 
  ChevronRight, 
  ArrowLeft,
  HardDrive,
  Cloud,
  Grid,
  List as ListIcon,
  X
} from 'lucide-react';

/**
 * UTILITIES & DATABASE LAYERS
 * We use raw IndexedDB wrapped in Promises to store files (Blobs) locally.
 */

const DB_NAME = 'LocalDriveDB';
const DB_VERSION = 1;
const STORE_NAME = 'files';

const dbApi = {
  open: () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('parentId', 'parentId', { unique: false });
        }
      };

      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject(event.target.error);
    });
  },

  add: async (item) => {
    const db = await dbApi.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(item);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  getItems: async (parentId) => {
    const db = await dbApi.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('parentId');
      const request = index.getAll(parentId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  delete: async (id) => {
    const db = await dbApi.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  // Recursively delete folders and content
  deleteRecursive: async (itemId) => {
    const db = await dbApi.open();
    // 1. Get the item to check if it's a folder
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    
    const getItem = () => new Promise((res) => {
      const req = store.get(itemId);
      req.onsuccess = () => res(req.result);
    });

    const item = await getItem();
    if (!item) return;

    if (item.isFolder) {
      const children = await dbApi.getItems(itemId);
      for (const child of children) {
        await dbApi.deleteRecursive(child.id);
      }
    }
    await dbApi.delete(itemId);
  },

  getAllFiles: async () => {
    const db = await dbApi.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
};

const formatBytes = (bytes, decimals = 2) => {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

/**
 * MAIN APPLICATION COMPONENT
 */
export default function App() {
  // -- State --
  const [currentFolderId, setCurrentFolderId] = useState('root');
  const [folderChain, setFolderChain] = useState([{ id: 'root', name: 'My Drive' }]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'
  const [usage, setUsage] = useState({ used: 0, percent: 0 });
  const [isModalOpen, setIsModalOpen] = useState(false); // For "New Folder"
  const [newFolderName, setNewFolderName] = useState('');
  const [previewItem, setPreviewItem] = useState(null); // For file preview
  const [contextMenu, setContextMenu] = useState(null); // { x, y, item }

  // -- Effects --

  useEffect(() => {
    fetchItems();
    calculateUsage();
  }, [currentFolderId]);

  // -- Logic --

  const fetchItems = async () => {
    setLoading(true);
    try {
      const fetchedItems = await dbApi.getItems(currentFolderId);
      // Sort: Folders first, then files, then alphabetical
      fetchedItems.sort((a, b) => {
        if (a.isFolder && !b.isFolder) return -1;
        if (!a.isFolder && b.isFolder) return 1;
        return a.name.localeCompare(b.name);
      });
      setItems(fetchedItems);
    } catch (err) {
      console.error("Failed to fetch items", err);
    } finally {
      setLoading(false);
    }
  };

  const calculateUsage = async () => {
    const allFiles = await dbApi.getAllFiles();
    const totalBytes = allFiles.reduce((acc, file) => acc + (file.size || 0), 0);
    
    // Estimate quota (navigator.storage is not always accurate in iframes, defaulting visuals)
    let quota = 1024 * 1024 * 1024; // Assume 1GB for visual reference if API fails
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      if (estimate.quota) quota = estimate.quota;
    }
    
    setUsage({
      used: totalBytes,
      percent: Math.min((totalBytes / quota) * 100, 100)
    });
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    setLoading(true);
    try {
      for (const file of files) {
        const newItem = {
          id: crypto.randomUUID(),
          parentId: currentFolderId,
          name: file.name,
          isFolder: false,
          type: file.type,
          size: file.size,
          createdAt: Date.now(),
          data: file // Storing the Blob directly
        };
        await dbApi.add(newItem);
      }
      await fetchItems();
      await calculateUsage();
    } catch (err) {
      alert("Error uploading file. Storage might be full.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    
    try {
      const newFolder = {
        id: crypto.randomUUID(),
        parentId: currentFolderId,
        name: newFolderName,
        isFolder: true,
        size: 0,
        createdAt: Date.now()
      };
      await dbApi.add(newFolder);
      setNewFolderName('');
      setIsModalOpen(false);
      fetchItems();
    } catch (err) {
      console.error(err);
    }
  };

  const handleNavigate = (folder) => {
    if (folder.id === 'root') {
      setFolderChain([{ id: 'root', name: 'My Drive' }]);
      setCurrentFolderId('root');
    } else {
      // Check if we are going back or forward
      const index = folderChain.findIndex(f => f.id === folder.id);
      if (index !== -1) {
        // Going back to a known breadcrumb
        setFolderChain(folderChain.slice(0, index + 1));
      } else {
        // Going deeper
        setFolderChain([...folderChain, folder]);
      }
      setCurrentFolderId(folder.id);
    }
  };

  const handleItemClick = (item) => {
    if (item.isFolder) {
      handleNavigate(item);
    } else {
      setPreviewItem(item);
    }
  };

  const handleDelete = async (item) => {
    if (confirm(`Are you sure you want to delete "${item.name}"?`)) {
      await dbApi.deleteRecursive(item.id);
      setContextMenu(null);
      setPreviewItem(null);
      fetchItems();
      calculateUsage();
    }
  };

  const handleDownload = (item) => {
    if (item.isFolder) return; // Simple implementation: no folder zipping yet
    const url = URL.createObjectURL(item.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;
    return items.filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [items, searchQuery]);

  // -- Render Helpers --

  const getIcon = (item) => {
    if (item.isFolder) return <Folder className="w-10 h-10 text-blue-500 fill-current" />;
    if (item.type.startsWith('image/')) return <ImageIcon className="w-10 h-10 text-purple-500" />;
    if (item.type.startsWith('video/')) return <Video className="w-10 h-10 text-red-500" />;
    if (item.type.startsWith('audio/')) return <Music className="w-10 h-10 text-pink-500" />;
    if (item.type.includes('pdf')) return <FileText className="w-10 h-10 text-orange-500" />;
    return <File className="w-10 h-10 text-gray-400" />;
  };

  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-800 font-sans overflow-hidden selection:bg-blue-100">
      
      {/* SIDEBAR */}
      <div className="hidden md:flex w-64 bg-white border-r border-slate-200 flex-col">
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white">
            <HardDrive size={20} />
          </div>
          <h1 className="text-xl font-bold text-slate-800">LocalBox</h1>
        </div>

        <div className="px-4 py-2">
          <label className="flex items-center justify-center w-full py-3 px-4 bg-white border-2 border-slate-100 shadow-sm rounded-xl cursor-pointer hover:bg-slate-50 hover:border-blue-200 hover:shadow-md transition-all group">
            <Plus className="w-5 h-5 mr-2 text-blue-600 group-hover:scale-110 transition-transform" />
            <span className="font-semibold text-slate-600 group-hover:text-blue-600">New File</span>
            <input type="file" multiple className="hidden" onChange={handleFileUpload} />
          </label>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="mt-2 flex items-center justify-center w-full py-3 px-4 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors font-medium text-sm"
          >
            <Folder className="w-4 h-4 mr-2" /> Create Folder
          </button>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-1">
          <button onClick={() => handleNavigate({id: 'root', name: 'My Drive'})} className={`flex items-center w-full px-4 py-2.5 text-sm font-medium rounded-lg ${currentFolderId === 'root' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}>
            <Home className="w-4 h-4 mr-3" /> My Drive
          </button>
          <div className="flex items-center w-full px-4 py-2.5 text-sm font-medium text-slate-400 cursor-not-allowed">
            <Cloud className="w-4 h-4 mr-3" /> Shared (Offline)
          </div>
          <div className="flex items-center w-full px-4 py-2.5 text-sm font-medium text-slate-400 cursor-not-allowed">
            <Trash2 className="w-4 h-4 mr-3" /> Trash
          </div>
        </nav>

        <div className="p-6 border-t border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500">Storage</span>
            <span className="text-xs text-slate-400">{formatBytes(usage.used)} used</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
            <div 
              className="bg-blue-500 h-2 rounded-full transition-all duration-500" 
              style={{ width: `${usage.percent}%` }}
            ></div>
          </div>
          <p className="text-[10px] text-slate-400 mt-2 leading-tight">
            Data is stored locally in your browser. Clearing browser data will delete these files.
          </p>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-white md:bg-slate-50 relative">
        
        {/* HEADER */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-8 shrink-0 z-10">
          
          {/* Mobile Menu / Breadcrumbs */}
          <div className="flex items-center gap-2 md:gap-4 overflow-hidden flex-1 mr-4">
            <button className="md:hidden p-2 text-slate-600" onClick={() => handleNavigate({id:'root'})}>
              {currentFolderId === 'root' ? <HardDrive size={20}/> : <ArrowLeft size={20} />}
            </button>

            <div className="flex items-center text-sm text-slate-500 overflow-x-auto no-scrollbar whitespace-nowrap">
              {folderChain.map((folder, index) => (
                <React.Fragment key={folder.id}>
                  {index > 0 && <ChevronRight className="w-4 h-4 mx-1 text-slate-300 shrink-0" />}
                  <button 
                    onClick={() => handleNavigate(folder)}
                    className={`hover:bg-slate-100 px-2 py-1 rounded-md transition-colors ${index === folderChain.length - 1 ? 'font-bold text-slate-800' : 'hover:text-blue-600'}`}
                  >
                    {folder.name}
                  </button>
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 md:gap-4 shrink-0">
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input 
                type="text" 
                placeholder="Search files..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-2 bg-slate-100 border-transparent focus:bg-white focus:ring-2 focus:ring-blue-500 rounded-full text-sm w-64 transition-all outline-none"
              />
            </div>
            
            <div className="flex bg-slate-100 p-1 rounded-lg">
              <button 
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-white shadow text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Grid size={16} />
              </button>
              <button 
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-white shadow text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <ListIcon size={16} />
              </button>
            </div>
          </div>
        </header>

        {/* FILE AREA */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8 scroll-smooth">
          
          {/* Mobile Fab */}
          <div className="md:hidden fixed bottom-6 right-6 z-20 flex flex-col gap-3">
            <button 
               onClick={() => setIsModalOpen(true)}
               className="w-12 h-12 bg-slate-700 text-white rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform"
            >
              <Folder size={20} />
            </button>
            <label className="w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg shadow-blue-600/30 flex items-center justify-center active:scale-95 transition-transform cursor-pointer">
              <Plus size={28} />
              <input type="file" multiple className="hidden" onChange={handleFileUpload} />
            </label>
          </div>

          {loading ? (
             <div className="flex flex-col items-center justify-center h-full text-slate-300">
               <div className="w-10 h-10 border-4 border-current border-t-transparent rounded-full animate-spin mb-4"></div>
               <p>Loading local files...</p>
             </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 md:h-full text-slate-400 border-2 border-dashed border-slate-200 rounded-3xl bg-slate-50/50">
              <div className="bg-slate-100 p-6 rounded-full mb-4">
                <Cloud className="w-12 h-12 text-slate-300" />
              </div>
              <h3 className="text-lg font-medium text-slate-600">This folder is empty</h3>
              <p className="text-sm max-w-xs text-center mt-2">Drag and drop files here or use the "New" button to get started.</p>
            </div>
          ) : (
            <>
              {/* SECTION HEADER */}
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
                  {searchQuery ? 'Search Results' : 'Files & Folders'}
                </h2>
                <span className="text-xs text-slate-400">{filteredItems.length} items</span>
              </div>

              {viewMode === 'grid' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {filteredItems.map((item) => (
                    <div 
                      key={item.id}
                      onClick={() => handleItemClick(item)}
                      className="group relative bg-white border border-slate-200 hover:border-blue-400 hover:shadow-md rounded-2xl p-4 flex flex-col items-center justify-center gap-3 aspect-[4/5] md:aspect-square transition-all cursor-pointer active:scale-95 select-none"
                    >
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={(e) => { e.stopPropagation(); setContextMenu({item, x:0, y:0}); handleDelete(item); }} 
                          className="p-1.5 hover:bg-red-50 rounded-full text-slate-400 hover:text-red-500"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      
                      <div className="flex-1 flex items-center justify-center w-full overflow-hidden">
                        {/* Image Preview Thumbnail if possible */}
                        {item.type?.startsWith('image/') && !item.isFolder ? (
                          <img 
                            src={URL.createObjectURL(item.data)} 
                            alt={item.name}
                            className="w-full h-full object-cover rounded-lg opacity-90 group-hover:opacity-100 transition-opacity"
                            onLoad={(e) => URL.revokeObjectURL(e.target.src)}
                          />
                        ) : (
                          getIcon(item)
                        )}
                      </div>
                      
                      <div className="w-full text-center">
                        <p className="text-sm font-medium text-slate-700 truncate w-full px-2">
                          {item.name}
                        </p>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {item.isFolder ? `${formatBytes(item.size)} items` : formatBytes(item.size)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-100">
                      <tr>
                        <th className="px-6 py-3">Name</th>
                        <th className="px-6 py-3 hidden sm:table-cell">Size</th>
                        <th className="px-6 py-3 hidden md:table-cell">Date Modified</th>
                        <th className="px-6 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredItems.map((item) => (
                        <tr 
                          key={item.id} 
                          onClick={() => handleItemClick(item)}
                          className="hover:bg-slate-50 cursor-pointer group transition-colors"
                        >
                          <td className="px-6 py-3 flex items-center gap-3 font-medium text-slate-700">
                            <div className="scale-75 origin-left">{getIcon(item)}</div>
                            <span className="truncate max-w-[150px] sm:max-w-xs">{item.name}</span>
                          </td>
                          <td className="px-6 py-3 text-slate-500 hidden sm:table-cell">
                            {item.isFolder ? '-' : formatBytes(item.size)}
                          </td>
                          <td className="px-6 py-3 text-slate-500 hidden md:table-cell">
                            {new Date(item.createdAt).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-3 text-right">
                            <button 
                               onClick={(e) => { e.stopPropagation(); handleDelete(item); }} 
                               className="p-2 hover:bg-red-100 rounded-full text-slate-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* CREATE FOLDER MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 animate-in fade-in zoom-in duration-200">
            <h3 className="text-lg font-bold text-slate-800 mb-4">New Folder</h3>
            <input 
              autoFocus
              type="text" 
              placeholder="Folder Name" 
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl mb-6 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded-lg font-medium text-sm"
              >
                Cancel
              </button>
              <button 
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FILE PREVIEW MODAL */}
      {previewItem && (
        <div className="fixed inset-0 bg-slate-900/95 z-50 flex flex-col animate-in fade-in duration-200">
          <div className="flex items-center justify-between p-4 text-white">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="bg-slate-800 p-2 rounded-lg">
                {getIcon(previewItem)}
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold truncate text-lg">{previewItem.name}</h3>
                <p className="text-slate-400 text-xs">{formatBytes(previewItem.size)} • {new Date(previewItem.createdAt).toLocaleString()}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => handleDownload(previewItem)}
                className="p-3 hover:bg-white/10 rounded-full transition-colors text-white"
                title="Download"
              >
                <Download size={24} />
              </button>
              <button 
                onClick={() => setPreviewItem(null)}
                className="p-3 hover:bg-white/10 rounded-full transition-colors text-white"
              >
                <X size={24} />
              </button>
            </div>
          </div>
          
          <div className="flex-1 overflow-auto flex items-center justify-center p-4 md:p-8">
            {previewItem.type.startsWith('image/') ? (
              <img 
                src={URL.createObjectURL(previewItem.data)} 
                alt={previewItem.name}
                className="max-w-full max-h-full object-contain shadow-2xl rounded-md"
              />
            ) : previewItem.type.startsWith('video/') ? (
              <video 
                controls 
                src={URL.createObjectURL(previewItem.data)} 
                className="max-w-full max-h-full rounded-lg shadow-2xl"
              />
            ) : previewItem.type.startsWith('audio/') ? (
              <div className="bg-slate-800 p-12 rounded-3xl flex flex-col items-center gap-6">
                 <Music size={64} className="text-pink-500 animate-pulse" />
                 <audio controls src={URL.createObjectURL(previewItem.data)} />
              </div>
            ) : previewItem.type === 'text/plain' || previewItem.name.endsWith('.txt') || previewItem.name.endsWith('.md') || previewItem.name.endsWith('.json') || previewItem.name.endsWith('.js') ? (
               <TextPreview file={previewItem.data} />
            ) : (
              <div className="text-center text-slate-400">
                <File className="w-24 h-24 mx-auto mb-4 opacity-50" />
                <p className="text-xl">No preview available</p>
                <button 
                  onClick={() => handleDownload(previewItem)} 
                  className="mt-4 text-blue-400 hover:underline"
                >
                  Download to view
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Helper component to read and display text content
function TextPreview({ file }) {
  const [content, setContent] = useState('Loading...');

  useEffect(() => {
    const reader = new FileReader();
    reader.onload = (e) => setContent(e.target.result);
    reader.readAsText(file);
  }, [file]);

  return (
    <div className="bg-white text-slate-800 p-8 rounded-lg shadow-xl max-w-3xl w-full h-full max-h-[80vh] overflow-auto font-mono text-sm whitespace-pre-wrap">
      {content}
    </div>
  );
}

