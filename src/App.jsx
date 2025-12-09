import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Camera, Trash2, Save, Truck, Users, Box, ArrowRight, Minus, Plus, AlertTriangle, Mic, StopCircle, Play, X, Ruler, MapPin, ExternalLink, History, ArrowLeft, Loader2, FileText, Calendar, CheckSquare, Coins, RefreshCw } from 'lucide-react';

// URL de déploiement de votre Google Apps Script (À REMPLACER IMPÉRATIVEMENT)
const GAS_ENDPOINT = "https://script.google.com/macros/s/AKfycbww2G_N9JwKlhErDrBo0W2_Q4Y9Ytbo2386D1Tvt2E6O8AZfCuDQC4UxMP8w3B4mm4/exec"; 

i

// --- VALEURS PAR DÉFAUT (Fallback Offline) ---
// Liste simplifiée regroupant les standards similaires
const DEFAULT_ITEMS = {
  furniture: [
    { id: 'workstation_full', name: 'Poste Travail Complet', vol: 4.0 }, // Bureau + Chaise + Caisson
    { id: 'desk_simple', name: 'Bureau Seul', vol: 1.5 },
    { id: 'chair_office', name: 'Chaise', vol: 0.3 },
    { id: 'storage_cabinet', name: 'Armoire Haute', vol: 1.5 },
    { id: 'storage_low', name: 'Meuble Bas / Caisson', vol: 0.4 },
    { id: 'meeting_table', name: 'Table Réunion (8-10p)', vol: 9.0 },
    { id: 'booth', name: 'Cabine/Box Acoustique', vol: 4.0 }, // Moyenne 1p/4p
    { id: 'sofa', name: 'Canapé / Détente', vol: 3.0 },
    { id: 'misc_large', name: 'Divers Volumineux (Frigo/Vestiaire)', vol: 2.0 },
  ],
  it: [
    { id: 'it_station', name: 'Poste IT (Ecran+UC)', vol: 0.8 },
    { id: 'printer_lg', name: 'Copieur Multifonction', vol: 1.4 },
    { id: 'printer_sm', name: 'Petite Imprimante', vol: 0.8 },
  ],
  boxes: [
    { id: 'box_std', name: 'Carton Standard', vol: 0.1 },
    { id: 'box_arch', name: 'Carton Archive', vol: 0.05 },
  ]
};

const DEFAULT_PARAMS = {
  prod_std: 7.0, prod_easy: 9.0, prod_hard: 5.0,
  van_cap: 12.0, truck_cap: 17.0,
  man_day: 400,
  van_day: 150, van_half: 75,
  truck_day: 350, truck_half: 250,
  km_inc: 50, km_rate_van: 0.8, km_rate_truck: 1.5,
  mat_rate: 5
};

export default function App() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  
  const [configItems, setConfigItems] = useState(DEFAULT_ITEMS);
  const [configParams, setConfigParams] = useState(DEFAULT_PARAMS);
  const [configLoaded, setConfigLoaded] = useState(false);

  const [historyData, setHistoryData] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedMission, setSelectedMission] = useState(null);

  const [mission, setMission] = useState({
    clientName: '', siteName: '', floor: '0', distance: '', elevator: true,
    elevatorDims: { w: '', d: '', h: '', weight: '' }, 
    parkingDistance: '0', stairs: 0, comments: '', voiceNotes: [], gps: null 
  });

  const [inventory, setInventory] = useState({});
  const [activeTab, setActiveTab] = useState('furniture'); 
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch(`${GAS_ENDPOINT}?action=config`);
        const json = await response.json();
        if (json.status === 'success') {
          setConfigItems(json.data.items);
          setConfigParams(json.data.params);
          setConfigLoaded(true);
        }
      } catch (e) { console.warn("Offline config", e); }
    };
    if (GAS_ENDPOINT.startsWith('http')) fetchConfig();
  }, []);

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
      if (json.status === 'success') setHistoryData(json.data);
    } catch (e) { alert("Erreur historique"); }
    finally { setHistoryLoading(false); }
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

  // --- CALCULATEUR COMPLET ---
  const stats = useMemo(() => {
    let totalVol = 0, trashVol = 0;
    
    Object.entries(inventory).forEach(([id, data]) => {
      const itemDef = Object.values(configItems).flat().find(i => i.id === id);
      if (itemDef) {
        totalVol += data.count * itemDef.vol;
        trashVol += data.trash * itemDef.vol;
      }
    });

    const totalHandlingVol = totalVol + trashVol;

    // 1. Productivité
    let productivityPerMan = configParams.prod_std || 7; 
    let difficultyLabel = "Standard";

    if (mission.elevator) {
        if (mission.parkingDistance === '0-10m') {
            productivityPerMan = configParams.prod_easy || 9;
            difficultyLabel = "Facile";
        }
    } else {
        productivityPerMan = configParams.prod_hard || 5;
        difficultyLabel = "Difficile";
    }
    if (mission.parkingDistance === '>50m') {
        productivityPerMan -= 1; 
        difficultyLabel += " + Portage";
    }

    const manDays = totalHandlingVol > 0 ? Math.ceil((totalHandlingVol / productivityPerMan) * 10) / 10 : 0;

    // 2. Véhicules (Fourgon vs Camion)
    // Seuil de bascule Fourgon/Camion : 12m3 (Capacité fourgon)
    const VAN_CAP = configParams.van_cap || 12;
    const TRUCK_CAP = configParams.truck_cap || 17;
    
    let vehicleType = 'van';
    let vehicleCount = 0;
    let vehicleLabel = '';

    if (totalVol <= VAN_CAP && totalVol > 0) {
        vehicleType = 'van';
        vehicleCount = Math.ceil(totalVol / VAN_CAP);
        vehicleLabel = `${vehicleCount} Fourgon(s)`;
    } else if (totalVol > 0) {
        vehicleType = 'truck';
        vehicleCount = Math.ceil(totalVol / TRUCK_CAP);
        vehicleLabel = `${vehicleCount} Camion(s)`;
    } else {
        vehicleLabel = 'Aucun';
    }

    // 3. Durée de location estimée (basée sur JH et Volume)
    // Hypothèse simple : Si petit volume (<15m3), 0.5j possible, sinon 1j mini
    let rentalDays = 1;
    let isHalfDay = false;
    
    if (manDays <= 0.6 && totalVol < 15) {
        rentalDays = 0.5;
        isHalfDay = true;
    } else {
        rentalDays = Math.ceil(manDays / 2); // Hypothèse: équipe de 2 min
        if (rentalDays < 1) rentalDays = 1;
    }

    // 4. Coûts
    const tripDist = parseFloat(mission.distance) || 0;
    // On compte l'aller-retour total (client -> b -> client) mais le paramètre est souvent la distance A->B
    // Prompt: "distance entre le point de depart et d arrivee".
    // Estimons le trajet total facturable = (Distance x 2).
    const totalKm = tripDist * 2;
    const extraKm = Math.max(0, totalKm - (configParams.km_inc || 50));

    let costVehicleBase = 0;
    let costKm = 0;

    if (vehicleType === 'van') {
        const rate = isHalfDay ? (configParams.van_half || 75) : (configParams.van_day || 150);
        costVehicleBase = vehicleCount * rate * Math.ceil(rentalDays); // Location
        costKm = vehicleCount * extraKm * (configParams.km_rate_van || 0.8);
    } else {
        const rate = isHalfDay ? (configParams.truck_half || 250) : (configParams.truck_day || 350);
        costVehicleBase = vehicleCount * rate * Math.ceil(rentalDays);
        costKm = vehicleCount * extraKm * (configParams.km_rate_truck || 1.5);
    }

    const costMan = manDays * (configParams.man_day || 400);
    const costMat = totalVol * (configParams.mat_rate || 5);

    const estimatedCostTotal = Math.round(costMan + costVehicleBase + costKm + costMat);

    return { 
        moveVol: totalVol, trashVol, manDays, 
        vehicleLabel, vehicleCount, vehicleType, rentalDays,
        extraKm, costKm,
        estimatedCostTotal, difficultyLabel 
    };
  }, [inventory, mission, configItems, configParams]);

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

  const handleSubmit = async () => {
    setLoading(true);
    const payload = { ...mission, inventory, stats, date: new Date().toISOString() };
    try {
      await fetch(GAS_ENDPOINT, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      alert("Envoyé !");
      setInventory({});
      setMission({ ...mission, comments: '', voiceNotes: [], gps: null, distance: '' });
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

  if (step === 1) return (
    <div className="min-h-screen bg-gray-50 pb-20 font-sans">
      {renderHeader("Nouvelle Mission")}
      <div className="p-4 space-y-4">
        {!configLoaded && <div className="text-xs text-orange-500 flex items-center gap-1 mb-2"><Loader2 className="animate-spin" size={12}/> Chargement configuration...</div>}
        <button onClick={() => { setStep(4); fetchHistory(); }} className="w-full py-3 bg-white text-blue-600 border border-blue-100 rounded-xl font-bold shadow-sm flex justify-center items-center gap-2 mb-4 hover:bg-blue-50">
          <History size={18}/> Voir les missions précédentes
        </button>
        <div className="bg-white p-4 rounded-lg shadow-sm">
          <label className="block text-sm font-medium text-gray-700 mb-1">Nom du Client</label>
          <input type="text" className="w-full p-3 border rounded-lg" placeholder="Ex: ACME Corp" value={mission.clientName} onChange={e => setMission({...mission, clientName: e.target.value})} />
        </div>
        
        {/* NEW: Distance Input */}
        <div className="bg-white p-4 rounded-lg shadow-sm">
          <label className="block text-sm font-medium text-gray-700 mb-1">Distance trajet (km)</label>
          <input type="number" className="w-full p-3 border rounded-lg" placeholder="Distance A vers B" value={mission.distance} onChange={e => setMission({...mission, distance: e.target.value})} />
          <p className="text-xs text-gray-400 mt-1">Saisir la distance simple (l'app calcule l'aller-retour).</p>
        </div>

        <div className="bg-white p-4 rounded-lg shadow-sm">
           <div className="flex justify-between items-center mb-2"><label className="block text-sm font-medium text-gray-700">Position du Site</label>{mission.gps && <span className="text-xs text-green-600 font-bold bg-green-50 px-2 py-1 rounded">±{Math.round(mission.gps.accuracy)}m</span>}</div>
           {!mission.gps ? <button onClick={getGPS} disabled={gpsLoading} className="w-full py-3 border-2 border-dashed border-blue-200 text-blue-600 rounded-lg font-bold flex justify-center items-center gap-2 hover:bg-blue-50">{gpsLoading ? <span className="animate-pulse">Acquisition...</span> : <><MapPin size={18}/> Obtenir Position GPS</>}</button> : <div className="p-3 bg-blue-50 rounded-lg flex justify-between items-center border border-blue-100"><div className="text-sm font-bold text-gray-800 flex items-center gap-1"><MapPin size={14}/> Position Enregistrée</div><button onClick={() => setMission({...mission, gps: null})} className="text-xs text-red-500 font-bold px-2">X</button></div>}
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm"><label className="block text-sm font-medium text-gray-700 mb-1">Étage / Zone</label><select className="w-full p-3 border rounded-lg bg-white" value={mission.floor} onChange={e => setMission({...mission, floor: e.target.value})}><option value="0">Rez-de-chaussée</option>{[1,2,3,4,5].map(i => <option key={i} value={i}>{i}ème Étage{i>3?'+':''}</option>)}</select></div>
        <div className="bg-white p-4 rounded-lg shadow-sm space-y-4">
          <h3 className="font-semibold text-gray-800">Accès & Logistique</h3>
          <div className="flex items-center justify-between"><span>Ascenseur utilisable ?</span><button onClick={() => setMission({...mission, elevator: !mission.elevator})} className={`px-4 py-2 rounded-lg font-bold ${mission.elevator ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{mission.elevator ? 'OUI' : 'NON'}</button></div>
          {mission.elevator ? (<div className="bg-gray-50 p-3 rounded-lg border border-gray-200 grid grid-cols-2 gap-2">{['w','d','h','weight'].map(k => (<div key={k}><label className="text-xs text-gray-400 capitalize">{k === 'weight' ? 'Charge (kg)' : k === 'w' ? 'Largeur' : k === 'd' ? 'Prof.' : 'Hauteur'}</label><input type="number" className="w-full p-2 rounded border text-sm" value={mission.elevatorDims[k]} onChange={e => setMission({...mission, elevatorDims: {...mission.elevatorDims, [k]: e.target.value}})} /></div>))}</div>) : (<div><label className="text-sm">Étages à pied</label><input type="number" value={mission.stairs} onChange={e => setMission({...mission, stairs: e.target.value})} className="w-full p-2 border rounded" /></div>)}
          <div><label className="text-sm block mb-2">Distance Camion</label><div className="flex gap-2">{['0-10m', '10-50m', '>50m'].map(opt => <button key={opt} onClick={() => setMission({...mission, parkingDistance: opt})} className={`flex-1 py-2 text-xs rounded border ${mission.parkingDistance === opt ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}>{opt}</button>)}</div></div>
        </div>
        <button onClick={() => setStep(2)} disabled={!mission.clientName} className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold shadow-lg disabled:opacity-50 flex justify-center items-center gap-2">Commencer l'Inventaire <ArrowRight size={20}/></button>
      </div>
    </div>
  );

  if (step === 2) return (
    <div className="min-h-screen bg-gray-50 pb-24 font-sans">
      {renderHeader(`${mission.clientName}`, () => setStep(1))}
      <div className="flex bg-white shadow-sm sticky top-14 z-10 overflow-x-auto">
        {[{id:'furniture',label:'Mobilier',icon:Box},{id:'it',label:'Info/Elec',icon:AlertTriangle},{id:'boxes',label:'Cartons',icon:Box}].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex-1 py-3 flex flex-col items-center text-xs border-b-2 ${activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}><tab.icon size={18} className="mb-1"/>{tab.label}</button>
        ))}
      </div>
      <div className="p-3 space-y-3">
        {configItems[activeTab] && configItems[activeTab].map(item => {
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

  if (step === 3) return (
    <div className="min-h-screen bg-gray-50 pb-20 font-sans">
      {renderHeader("Synthèse", () => setStep(2))}
      <div className="p-4 space-y-4">
        <div className="bg-white rounded-xl shadow p-4">
          <div className="flex justify-between items-center mb-4 border-b pb-2"><h2 className="text-gray-500 text-sm font-bold uppercase">Estimation des moyens</h2><span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded">{stats.difficultyLabel}</span></div>
          <div className="grid grid-cols-2 gap-4 text-center">
            <div className="p-3 bg-blue-50 rounded-lg"><Truck className="mx-auto text-blue-600 mb-2" /><div className="text-2xl font-bold">{stats.moveVol.toFixed(1)} m³</div><div className="text-[10px] text-gray-500">Volume Déménagement</div></div>
            <div className="p-3 bg-red-50 rounded-lg"><Trash2 className="mx-auto text-red-500 mb-2" /><div className="text-2xl font-bold">{stats.trashVol.toFixed(1)} m³</div><div className="text-[10px] text-gray-500">Volume Déchetterie</div></div>
          </div>
          <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-4 text-center">
            <div><div className="text-xl font-bold">{stats.manDays}</div><div className="text-xs text-gray-500">Jours-Hommes</div><div className="text-[10px] text-gray-400">Base {stats.productivityUsed} m³/j</div></div>
            <div><div className="text-xl font-bold">{stats.vehicleLabel}</div><div className="text-xs text-gray-500">{stats.rentalDays} jour(s)</div>
            {stats.extraKm > 0 && <div className="text-[10px] text-red-500">+{Math.round(stats.extraKm)} km suppl.</div>}
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow p-4 border border-yellow-100 bg-yellow-50">
           <h2 className="text-yellow-700 text-sm font-bold uppercase mb-2 flex items-center gap-2"><Coins size={16}/> Estimation Budget (CHF)</h2>
           <div className="text-center"><span className="text-3xl font-bold text-gray-800">{stats.estimatedCostTotal} CHF</span><p className="text-xs text-gray-500 mt-1">Hors taxes. Inclus: MO, Véhicules, Km, Matériel.</p></div>
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

  if (step === 4) return (
    <div className="min-h-screen bg-gray-50 pb-20 font-sans">
      {renderHeader("Historique", () => setStep(1))}
      <div className="p-4 space-y-3">
        {historyLoading && <div className="text-center text-gray-400"><Loader2 className="animate-spin inline"/> Chargement...</div>}
        {historyData.map((row, idx) => (
          <button key={idx} onClick={() => {setSelectedMission(row); setStep(5);}} className="w-full text-left bg-white p-4 rounded-xl shadow-sm border">{row.client} - {new Date(row.date).toLocaleDateString()}</button>
        ))}
      </div>
    </div>
  );

  if (step === 5 && selectedMission) {
     return (
        <div className="min-h-screen bg-gray-50 pb-20 font-sans">
          {renderHeader("Détail", () => setStep(4))}
          <div className="p-4 bg-white m-4 rounded shadow">
             <h2 className="font-bold text-xl">{selectedMission.client}</h2>
             <p className="mt-2 text-sm text-gray-500 flex items-center gap-1"><Car size={14}/> {selectedMission.vehicles}</p>
             <p className="mt-4 text-gray-600">{selectedMission.comments}</p>
             <div className="mt-4 bg-blue-50 p-4 rounded text-sm">
                <strong>Budget Est:</strong> {selectedMission.cost} CHF<br/>
                <strong>Vol:</strong> {selectedMission.volMove} m3 <br/>
                <strong>JH:</strong> {selectedMission.manDays}
             </div>
          </div>
        </div>
     );
  }

  return null;
}
