import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Camera, Trash2, Save, Truck, Users, Box, ArrowRight, Minus, Plus, AlertTriangle, Mic, StopCircle, Play, X, Ruler, MapPin, ExternalLink, History, ArrowLeft, Loader2, FileText, Calendar, CheckSquare } from 'lucide-react';

// --- CONFIGURATION LOGISTIQUE ---
const ITEMS_DB = {
  furniture: [
    { id: 'desk', name: 'Bureau Standard', vol: 0.7 },
    { id: 'chair', name: 'Fauteuil Ergo', vol: 0.2 },
    { id: 'cabinet', name: 'Armoire Haute', vol: 1.5 },
    { id: 'low_cabinet', name: 'Armoire Basse', vol: 0.8 },
    { id: 'meeting_table', name: 'Table Réunion', vol: 2.5 },
  ],
  it: [
    { id: 'screen', name: 'Écran', vol: 0.1 },
    { id: 'pc', name: 'Tour PC / UC', vol: 0.1 },
    { id: 'printer_sm', name: 'Imprimante Bur.', vol: 0.2 },
    { id: 'printer_lg', name: 'Copieur MF', vol: 1.0 },
  ],
  boxes: [
    { id: 'box_std', name: 'Carton Standard', vol: 0.1 },
    { id: 'box_book', name: 'Carton Livre', vol: 0.06 },
    { id: 'box_arch', name: 'Carton Archive', vol: 0.05 },
  ]
};

// URL de déploiement de votre Google Apps Script (À REMPLACER)
const GAS_ENDPOINT = "https://script.google.com/macros/s/AKfycbww2G_N9JwKlhErDrBo0W2_Q4Y9Ytbo2386D1Tvt2E6O8AZfCuDQC4UxMP8w3B4mm4/exec"; 

export default function App() {
  // --- ETAT DE L'APPLICATION ---
  const [step, setStep] = useState(1); // 1: Info, 2: Inventaire, 3: Synthèse, 4: Historique, 5: Détail Mission
  const [loading, setLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  
  // Historique & Détail
  const [historyData, setHistoryData] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedMission, setSelectedMission] = useState(null); // Mission sélectionnée pour le détail

  // Données de mission (Saisie en cours)
  const [mission, setMission] = useState({
    clientName: '',
    siteName: '',
    floor: '0',
    elevator: true,
    elevatorDims: { w: '', d: '', h: '', weight: '' }, 
    parkingDistance: '0', 
    stairs: 0,
    comments: '', 
    voiceNotes: [],
    gps: null 
  });

  const [inventory, setInventory] = useState({});
  const [activeTab, setActiveTab] = useState('furniture'); 
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  // --- LOGIQUE METIER ---

  const getGPS = () => {
    if (!navigator.geolocation) { alert("Pas de GPS"); return; }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMission(prev => ({ ...prev, gps: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy } }));
        setGpsLoading(false);
      },
      (err) => { alert("Erreur GPS"); setGpsLoading(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const response = await fetch(GAS_ENDPOINT);
      const json = await response.json();
      if (json.status === 'success') {
        setHistoryData(json.data);
      } else {
        alert("Erreur lecture historique");
      }
    } catch (e) {
      console.error(e);
      alert("Impossible de charger l'historique (Erreur réseau ?)");
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleViewDetail = (missionData) => {
    setSelectedMission(missionData);
    setStep(5);
  };

  const updateItem = (itemId, type, delta) => {
    setInventory(prev => {
      const current = prev[itemId] || { count: 0, trash: 0 };
      const field = type === 'trash' ? 'trash' : 'count';
      const newVal = Math.max(0, current[field] + delta);
      if (newVal === 0 && current[type === 'trash' ? 'count' : 'trash'] === 0) {
        const { [itemId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [itemId]: { ...current, [field]: newVal } };
    });
  };

  // Audio Logic
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      mediaRecorderRef.current.onstop = () => {
        const reader = new FileReader();
        reader.readAsDataURL(new Blob(audioChunksRef.current, { type: 'audio/webm' }));
        reader.onloadend = () => setMission(prev => ({ ...prev, voiceNotes: [...prev.voiceNotes, { id: Date.now(), data: reader.result }] }));
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) { alert("Erreur micro"); }
  };
  const stopRecording = () => { if (mediaRecorderRef.current) { mediaRecorderRef.current.stop(); setIsRecording(false); } };
  const deleteVoiceNote = (id) => setMission(prev => ({ ...prev, voiceNotes: prev.voiceNotes.filter(n => n.id !== id) }));
  const playVoiceNote = (data) => new Audio(data).play();

  // Calculs
  const stats = useMemo(() => {
    let totalVol = 0, trashVol = 0, itemCount = 0;
    Object.entries(inventory).forEach(([id, data]) => {
      const itemDef = Object.values(ITEMS_DB).flat().find(i => i.id === id);
      if (itemDef) {
        totalVol += data.count * itemDef.vol;
        trashVol += data.trash * itemDef.vol;
        itemCount += data.count + data.trash;
      }
    });
    let diff = 1.0;
    if (!mission.elevator) diff += 0.2 + (parseInt(mission.stairs || 0) * 0.15);
    if (mission.parkingDistance === '>50m') diff += 0.3;
    const manDays = Math.ceil(((totalVol + trashVol) / (12 / diff)) * 10) / 10;
    return { moveVol: totalVol, trashVol, manDays, trucks20: Math.ceil(totalVol / 20), difficulty: diff };
  }, [inventory, mission]);

  // Envoi
  const handleSubmit = async () => {
    setLoading(true);
    const payload = { ...mission, inventory, stats, date: new Date().toISOString() };
    try {
      await fetch(GAS_ENDPOINT, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      alert("Envoyé !");
      setInventory({});
      setMission({ ...mission, comments: '', voiceNotes: [], gps: null });
      setStep(1);
    } catch (e) {
      alert("Erreur envoi. Sauvegardé localement.");
      localStorage.setItem('backup_inventory', JSON.stringify(payload));
    } finally { setLoading(false); }
  };

  const renderHeader = (title, backAction = null) => (
    <div className="bg-blue-900 text-white p-4 shadow-md sticky top-0 z-10 flex justify-between items-center">
      <div className="flex items-center gap-2">
        {backAction && <button onClick={backAction}><ArrowLeft size={20}/></button>}
        <h1 className="text-lg font-bold">{title}</h1>
      </div>
      {(step === 2 || step === 3) && <div className="text-xs bg-blue-800 px-2 py-1 rounded">{stats.moveVol.toFixed(1)} m³</div>}
    </div>
  );

  // ECRAN 5 : FICHE DE DÉMÉNAGEMENT (DETAIL)
  if (step === 5 && selectedMission) {
    // Parsing de l'inventaire sauvegardé
    let savedInventory = {};
    try { savedInventory = JSON.parse(selectedMission.inventoryJson || '{}'); } catch(e) {}
    const hasInventory = Object.keys(savedInventory).length > 0;

    return (
      <div className="min-h-screen bg-gray-50 pb-20 font-sans">
        {renderHeader("Fiche Déménagement", () => setStep(4))}
        
        <div className="p-4 space-y-4">
          
          {/* Header Info */}
          <div className="bg-white rounded-xl shadow-sm p-4 border-l-4 border-blue-600">
            <h2 className="text-xl font-bold text-gray-800">{selectedMission.client}</h2>
            <div className="flex items-center gap-2 text-sm text-gray-500 mt-1">
              <Calendar size={14}/> {new Date(selectedMission.date).toLocaleDateString()}
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-500 mt-1">
               <MapPin size={14}/> {selectedMission.site}
            </div>
          </div>

          {/* KPI Logistique */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-blue-50 p-2 rounded-lg text-center border border-blue-100">
               <div className="text-lg font-bold text-blue-700">{Number(selectedMission.volMove).toFixed(1)}</div>
               <div className="text-[10px] text-gray-500 uppercase">Vol. m³</div>
            </div>
            <div className="bg-white p-2 rounded-lg text-center border border-gray-200">
               <div className="text-lg font-bold text-gray-700">{selectedMission.manDays}</div>
               <div className="text-[10px] text-gray-500 uppercase">Jours/H</div>
            </div>
            <div className="bg-white p-2 rounded-lg text-center border border-gray-200">
               <div className="text-lg font-bold text-gray-700">{selectedMission.trucks}</div>
               <div className="text-[10px] text-gray-500 uppercase">Camions</div>
            </div>
          </div>

          {/* Accès & GPS */}
          <div className="bg-white rounded-xl shadow-sm p-4">
            <h3 className="text-sm font-bold uppercase text-gray-500 mb-3 border-b pb-2">Accès & Localisation</h3>
            <div className="space-y-2 text-sm">
               <div className="flex justify-between">
                 <span className="text-gray-500">Accès Immeuble:</span>
                 <span className="font-medium text-gray-800">{selectedMission.access}</span>
               </div>
               <div className="flex justify-between">
                 <span className="text-gray-500">Stationnement:</span>
                 <span className="font-medium text-gray-800">{selectedMission.parking}</span>
               </div>
               {selectedMission.gps && (
                 <div className="mt-3 pt-2 border-t">
                   <a 
                     href={selectedMission.gps.startsWith('http') ? selectedMission.gps : '#'} 
                     target="_blank" rel="noreferrer"
                     className="flex items-center justify-center gap-2 w-full py-2 bg-blue-50 text-blue-600 rounded-lg font-bold text-xs"
                   >
                     <MapPin size={16}/> Ouvrir la position GPS dans Maps
                   </a>
                 </div>
               )}
            </div>
          </div>

          {/* Commentaires & Audio */}
          {(selectedMission.comments || selectedMission.audioCount > 0) && (
             <div className="bg-white rounded-xl shadow-sm p-4">
               <h3 className="text-sm font-bold uppercase text-gray-500 mb-3 border-b pb-2">Observations</h3>
               {selectedMission.comments && (
                 <p className="text-sm text-gray-700 italic bg-gray-50 p-2 rounded mb-2">"{selectedMission.comments}"</p>
               )}
               {selectedMission.audioCount > 0 && (
                 <div className="flex items-center gap-2 text-sm text-blue-600 font-medium">
                   <Mic size={16}/> {selectedMission.audioCount} note(s) vocale(s) disponible(s) sur Drive.
                 </div>
               )}
             </div>
          )}

          {/* Liste Inventaire */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
             <div className="bg-gray-100 p-3 border-b flex justify-between items-center">
                <h3 className="text-sm font-bold uppercase text-gray-600">Inventaire Détaillé</h3>
                <span className="text-xs bg-gray-200 px-2 py-1 rounded text-gray-600">Total m³: {(Number(selectedMission.volMove) + Number(selectedMission.volTrash)).toFixed(1)}</span>
             </div>
             {!hasInventory ? (
               <div className="p-4 text-center text-gray-400 text-sm">Aucun détail d'inventaire disponible.</div>
             ) : (
               <ul className="divide-y divide-gray-100">
                 {Object.entries(savedInventory).map(([id, data]) => {
                    const itemDef = Object.values(ITEMS_DB).flat().find(i => i.id === id);
                    if (!itemDef) return null;
                    return (
                      <li key={id} className="p-3 flex justify-between items-center text-sm hover:bg-gray-50">
                        <div>
                          <span className="font-medium text-gray-800">{itemDef.name}</span>
                          <div className="text-[10px] text-gray-400">{itemDef.vol} m³ / u</div>
                        </div>
                        <div className="flex gap-2">
                           {data.count > 0 && <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-bold">{data.count}</span>}
                           {data.trash > 0 && <span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-bold flex items-center gap-1"><Trash2 size={10}/>{data.trash}</span>}
                        </div>
                      </li>
                    );
                 })}
               </ul>
             )}
          </div>
        </div>
      </div>
    );
  }

  // ECRAN 4 : HISTORIQUE
  if (step === 4) return (
    <div className="min-h-screen bg-gray-50 pb-20 font-sans">
      {renderHeader("Historique Missions", () => setStep(1))}
      <div className="p-4">
        {historyLoading ? (
          <div className="flex flex-col items-center justify-center pt-20 text-gray-400">
            <Loader2 className="animate-spin mb-2" size={32}/>
            <p>Chargement des données...</p>
          </div>
        ) : (
          <div className="space-y-3">
            {historyData.length === 0 ? <p className="text-center text-gray-400 pt-10">Aucune mission trouvée.</p> : null}
            {historyData.map((row, idx) => (
              <button 
                key={idx} 
                onClick={() => handleViewDetail(row)}
                className="w-full text-left bg-white p-4 rounded-xl shadow-sm border border-gray-100 active:scale-[0.98] transition-transform hover:border-blue-300"
              >
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-bold text-gray-800 text-lg">{row.client}</h3>
                  <span className="text-xs text-gray-500">{new Date(row.date).toLocaleDateString()}</span>
                </div>
                <div className="text-sm text-gray-600 mb-3 flex items-center gap-1"><MapPin size={12}/> {row.site}</div>
                <div className="grid grid-cols-2 gap-2 text-center bg-gray-50 p-2 rounded-lg pointer-events-none">
                  <div>
                    <div className="text-lg font-bold text-blue-600">{Number(row.volMove).toFixed(1)} <span className="text-xs">m³</span></div>
                    <div className="text-[10px] uppercase text-gray-400">Déménagement</div>
                  </div>
                  <div className="flex items-center justify-center gap-1 text-gray-400">
                     <span className="text-xs font-bold">Voir Fiche</span> <ArrowRight size={12}/>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // ECRAN 1 : CONFIGURATION
  if (step === 1) return (
    <div className="min-h-screen bg-gray-50 pb-20 font-sans">
      {renderHeader("Nouvelle Mission")}
      <div className="p-4 space-y-4">
        
        {/* Bouton Historique */}
        <button 
          onClick={() => { setStep(4); fetchHistory(); }}
          className="w-full py-3 bg-white text-blue-600 border border-blue-100 rounded-xl font-bold shadow-sm flex justify-center items-center gap-2 mb-4 hover:bg-blue-50"
        >
          <History size={18}/> Voir les missions précédentes
        </button>

        <div className="bg-white p-4 rounded-lg shadow-sm">
          <label className="block text-sm font-medium text-gray-700 mb-1">Nom du Client</label>
          <input type="text" className="w-full p-3 border rounded-lg" placeholder="Ex: ACME Corp" value={mission.clientName} onChange={e => setMission({...mission, clientName: e.target.value})} />
        </div>

        <div className="bg-white p-4 rounded-lg shadow-sm">
           <div className="flex justify-between items-center mb-2">
             <label className="block text-sm font-medium text-gray-700">Position du Site</label>
             {mission.gps && <span className="text-xs text-green-600 font-bold bg-green-50 px-2 py-1 rounded">±{Math.round(mission.gps.accuracy)}m</span>}
           </div>
           {!mission.gps ? (
             <button onClick={getGPS} disabled={gpsLoading} className="w-full py-3 border-2 border-dashed border-blue-200 text-blue-600 rounded-lg font-bold flex justify-center items-center gap-2 hover:bg-blue-50">
               {gpsLoading ? <span className="animate-pulse">Acquisition...</span> : <><MapPin size={18}/> Obtenir Position GPS</>}
             </button>
           ) : (
             <div className="p-3 bg-blue-50 rounded-lg flex justify-between items-center border border-blue-100">
               <div className="text-sm font-bold text-gray-800 flex items-center gap-1"><MapPin size={14}/> Position Enregistrée</div>
               <button onClick={() => setMission({...mission, gps: null})} className="text-xs text-red-500 font-bold px-2">X</button>
             </div>
           )}
        </div>

        <div className="bg-white p-4 rounded-lg shadow-sm">
          <label className="block text-sm font-medium text-gray-700 mb-1">Étage / Zone</label>
          <select className="w-full p-3 border rounded-lg bg-white" value={mission.floor} onChange={e => setMission({...mission, floor: e.target.value})}>
            <option value="0">Rez-de-chaussée</option>
            {[1,2,3,4,5].map(i => <option key={i} value={i}>{i}ème Étage{i>3?'+':''}</option>)}
          </select>
        </div>

        <div className="bg-white p-4 rounded-lg shadow-sm space-y-4">
          <h3 className="font-semibold text-gray-800">Accès & Logistique</h3>
          <div className="flex items-center justify-between">
            <span>Ascenseur utilisable ?</span>
            <button onClick={() => setMission({...mission, elevator: !mission.elevator})} className={`px-4 py-2 rounded-lg font-bold ${mission.elevator ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{mission.elevator ? 'OUI' : 'NON'}</button>
          </div>
          {mission.elevator ? (
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 grid grid-cols-2 gap-2">
               {['w','d','h','weight'].map(k => (
                 <div key={k}><label className="text-xs text-gray-400 capitalize">{k === 'weight' ? 'Charge (kg)' : k === 'w' ? 'Largeur' : k === 'd' ? 'Prof.' : 'Hauteur'}</label>
                 <input type="number" className="w-full p-2 rounded border text-sm" value={mission.elevatorDims[k]} onChange={e => setMission({...mission, elevatorDims: {...mission.elevatorDims, [k]: e.target.value}})} /></div>
               ))}
            </div>
          ) : (
             <div><label className="text-sm">Étages à pied</label><input type="number" value={mission.stairs} onChange={e => setMission({...mission, stairs: e.target.value})} className="w-full p-2 border rounded" /></div>
          )}
          <div>
            <label className="text-sm block mb-2">Distance Camion</label>
            <div className="flex gap-2">{['0-10m', '10-50m', '>50m'].map(opt => <button key={opt} onClick={() => setMission({...mission, parkingDistance: opt})} className={`flex-1 py-2 text-xs rounded border ${mission.parkingDistance === opt ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}>{opt}</button>)}</div>
          </div>
        </div>
        <button onClick={() => setStep(2)} disabled={!mission.clientName} className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold shadow-lg disabled:opacity-50 flex justify-center items-center gap-2">Commencer l'Inventaire <ArrowRight size={20}/></button>
      </div>
    </div>
  );

  // ECRAN 2 (INVENTAIRE)
  if (step === 2) return (
    <div className="min-h-screen bg-gray-50 pb-24 font-sans">
      {renderHeader(`${mission.clientName}`, () => setStep(1))}
      <div className="flex bg-white shadow-sm sticky top-14 z-10 overflow-x-auto">
        {[{id:'furniture',label:'Mobilier',icon:Box},{id:'it',label:'Info/Elec',icon:AlertTriangle},{id:'boxes',label:'Cartons',icon:Box}].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex-1 py-3 flex flex-col items-center text-xs border-b-2 ${activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}><tab.icon size={18} className="mb-1"/>{tab.label}</button>
        ))}
      </div>
      <div className="p-3 space-y-3">
        {ITEMS_DB[activeTab].map(item => {
          const count = inventory[item.id]?.count || 0;
          const trash = inventory[item.id]?.trash || 0;
          return (
            <div key={item.id} className="bg-white rounded-xl shadow-sm p-3 border border-gray-100">
              <div className="flex justify-between items-start mb-2">
                <div><h3 className="font-bold text-gray-800">{item.name}</h3><p className="text-xs text-gray-400">{item.vol} m³</p></div>
                {(count > 0 || trash > 0) && <div className="text-xs font-bold bg-blue-50 text-blue-700 px-2 py-1 rounded">Total: {count + trash}</div>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-green-50 rounded-lg p-2 flex justify-between items-center"><button onClick={() => updateItem(item.id, 'count', -1)} className="w-8 h-8 rounded-full bg-white shadow flex items-center justify-center"><Minus size={16}/></button><span className="font-bold">{count}</span><button onClick={() => updateItem(item.id, 'count', 1)} className="w-8 h-8 rounded-full bg-green-500 text-white shadow flex items-center justify-center"><Plus size={16}/></button></div>
                <div className="bg-red-50 rounded-lg p-2 flex justify-between items-center"><button onClick={() => updateItem(item.id, 'trash', -1)} className="w-8 h-8 rounded-full bg-white shadow flex items-center justify-center"><Minus size={16}/></button><span className="font-bold">{trash}</span><button onClick={() => updateItem(item.id, 'trash', 1)} className="w-8 h-8 rounded-full bg-red-500 text-white shadow flex items-center justify-center"><Plus size={16}/></button></div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200 flex gap-3"><button onClick={() => setStep(1)} className="px-4 py-3 border rounded-lg font-bold">Retour</button><button onClick={() => setStep(3)} className="flex-1 py-3 bg-blue-600 text-white rounded-lg font-bold shadow-lg">Voir Synthèse</button></div>
    </div>
  );

  // ECRAN 3 (SYNTHESE)
  if (step === 3) return (
    <div className="min-h-screen bg-gray-50 pb-20 font-sans">
      {renderHeader("Synthèse", () => setStep(2))}
      <div className="p-4 space-y-4">
        <div className="bg-white rounded-xl shadow p-4">
          <div className="grid grid-cols-2 gap-4 text-center">
            <div className="p-3 bg-blue-50 rounded-lg"><Truck className="mx-auto text-blue-600 mb-2" /><div className="text-2xl font-bold">{stats.moveVol.toFixed(1)} m³</div></div>
            <div className="p-3 bg-red-50 rounded-lg"><Trash2 className="mx-auto text-red-500 mb-2" /><div className="text-2xl font-bold">{stats.trashVol.toFixed(1)} m³</div></div>
          </div>
          <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-4 text-center">
            <div><div className="text-xl font-bold">{stats.manDays}</div><div className="text-xs text-gray-500">Jours-Hommes</div></div>
            <div><div className="text-xl font-bold">{stats.trucks20}</div><div className="text-xs text-gray-500">Camions</div></div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow p-4">
          <textarea className="w-full border rounded p-2 text-sm mb-3" rows="3" placeholder="Commentaires..." value={mission.comments} onChange={e => setMission({...mission, comments: e.target.value})} />
          <div className="flex justify-between items-center mb-2"><span className="text-sm font-bold">Notes Vocales</span>{!isRecording ? <button onClick={startRecording} className="bg-red-100 text-red-600 px-3 py-1 rounded-full text-xs font-bold"><Mic size={14}/> Rec</button> : <button onClick={stopRecording} className="bg-red-600 text-white px-3 py-1 rounded-full text-xs animate-pulse"><StopCircle size={14}/> Stop</button>}</div>
          <div className="space-y-2">{mission.voiceNotes.map((n, i) => <div key={n.id} className="flex justify-between bg-gray-50 p-2 rounded"><button onClick={() => playVoiceNote(n.data)}><Play size={12}/></button> Note {i+1} <button onClick={() => deleteVoiceNote(n.id)}><X size={14}/></button></div>)}</div>
        </div>
        <button onClick={handleSubmit} disabled={loading} className={`w-full py-4 rounded-xl font-bold shadow-lg text-white flex justify-center items-center gap-2 ${loading ? 'bg-gray-400' : 'bg-green-600'}`}>{loading ? 'Envoi...' : <><Save size={20}/> Valider</>}</button>
      </div>
    </div>
  );
}
