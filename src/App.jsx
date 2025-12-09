import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Camera, Trash2, Save, Truck, Users, Box, ArrowRight, Minus, Plus, AlertTriangle, Mic, StopCircle, Play, X, Ruler, MapPin, ExternalLink } from 'lucide-react';

// --- CONFIGURATION LOGISTIQUE ---
// Volumes standards en m3
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
  const [step, setStep] = useState(1); // 1: Info, 2: Inventaire, 3: Synthèse
  const [loading, setLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false); // État de chargement spécifique au GPS
  
  // Données de mission
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
    gps: null // New: { lat, lng, accuracy }
  });

  // Inventaire : dictionnaire { itemId: { count: 0, trash: 0 } }
  const [inventory, setInventory] = useState({});
  const [activeTab, setActiveTab] = useState('furniture'); 

  // Gestion Audio
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  // --- LOGIQUE METIER ---

  // Gestion GPS
  const getGPS = () => {
    if (!navigator.geolocation) {
      alert("La géolocalisation n'est pas supportée par votre navigateur.");
      return;
    }

    setGpsLoading(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setMission(prev => ({
          ...prev,
          gps: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy
          }
        }));
        setGpsLoading(false);
      },
      (error) => {
        console.error("Erreur GPS:", error);
        let msg = "Impossible de récupérer la position.";
        if (error.code === 1) msg = "Permission GPS refusée.";
        if (error.code === 2) msg = "Position indisponible (pas de signal).";
        if (error.code === 3) msg = "Délai d'attente GPS dépassé.";
        alert(msg);
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  // Ajout/Retrait items
  const updateItem = (itemId, type, delta) => {
    setInventory(prev => {
      const current = prev[itemId] || { count: 0, trash: 0 };
      const field = type === 'trash' ? 'trash' : 'count';
      const newVal = Math.max(0, current[field] + delta);
      
      // Si tout est à 0, on supprime la clé pour nettoyer
      if (newVal === 0 && current[type === 'trash' ? 'count' : 'trash'] === 0) {
        const { [itemId]: _, ...rest } = prev;
        return rest;
      }

      return {
        ...prev,
        [itemId]: { ...current, [field]: newVal }
      };
    });
  };

  // Enregistrement Audio
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64Audio = reader.result;
          setMission(prev => ({
            ...prev,
            voiceNotes: [...prev.voiceNotes, { id: Date.now(), data: base64Audio }]
          }));
        };
        // Stop tracks to release mic
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Erreur micro:", err);
      alert("Impossible d'accéder au micro. Vérifiez les permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const deleteVoiceNote = (id) => {
    setMission(prev => ({
      ...prev,
      voiceNotes: prev.voiceNotes.filter(n => n.id !== id)
    }));
  };

  const playVoiceNote = (base64Data) => {
    const audio = new Audio(base64Data);
    audio.play();
  };

  // Calculs automatiques
  const stats = useMemo(() => {
    let totalVol = 0;
    let trashVol = 0;
    let itemCount = 0;

    Object.entries(inventory).forEach(([id, data]) => {
      // Trouver l'objet dans la DB
      let itemDef;
      Object.values(ITEMS_DB).forEach(cat => {
        const found = cat.find(i => i.id === id);
        if (found) itemDef = found;
      });

      if (itemDef) {
        const itemVol = itemDef.vol;
        totalVol += data.count * itemVol;
        trashVol += data.trash * itemVol;
        itemCount += data.count + data.trash;
      }
    });

    // Calcul Difficulté
    let difficulty = 1.0;
    if (!mission.elevator) difficulty += 0.2; // Pas d'ascenseur
    difficulty += (parseInt(mission.stairs || 0) * 0.15); // Étages sans ascenseur
    if (mission.parkingDistance === '>50m') difficulty += 0.3;

    // Estimation : 12m3 / Homme / Jour (Base)
    const baseProductivity = 12;
    const realProductivity = baseProductivity / difficulty;
    
    // Total à déménager (on ne compte pas la déchetterie dans le transfert, mais dans la manutention on compte tout)
    const moveVol = totalVol; 
    const totalHandlingVol = totalVol + trashVol;

    const manDays = Math.ceil((totalHandlingVol / realProductivity) * 10) / 10;
    
    // Estimation Camions (Base 20m3 pour simplifier)
    const trucks20 = Math.ceil(moveVol / 20);

    return { totalVol, trashVol, moveVol, manDays, trucks20, itemCount, difficulty };
  }, [inventory, mission]);

  // --- SOUMISSION ---
  const handleSubmit = async () => {
    if (!GAS_ENDPOINT.startsWith('http')) {
      alert("Erreur: URL du script Google non configurée dans le code.");
      return;
    }

    setLoading(true);
    const payload = {
      ...mission,
      inventory: inventory,
      stats: stats,
      date: new Date().toISOString()
    };

    try {
      await fetch(GAS_ENDPOINT, {
        method: 'POST',
        mode: 'no-cors', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      alert("Inventaire envoyé avec succès !");
      setInventory({});
      setMission({ ...mission, comments: '', voiceNotes: [], gps: null }); // Reset
      setStep(1);
    } catch (e) {
      console.error(e);
      alert("Erreur lors de l'envoi (vérifiez la connexion). Données sauvegardées localement.");
      localStorage.setItem('backup_inventory', JSON.stringify(payload));
    } finally {
      setLoading(false);
    }
  };

  // --- RENDU DES COMPOSANTS ---

  const renderHeader = (title) => (
    <div className="bg-blue-900 text-white p-4 shadow-md sticky top-0 z-10 flex justify-between items-center">
      <h1 className="text-lg font-bold">{title}</h1>
      <div className="text-xs bg-blue-800 px-2 py-1 rounded">
        {stats.moveVol.toFixed(1)} m³
      </div>
    </div>
  );

  // ECRAN 1 : CONFIGURATION
  if (step === 1) return (
    <div className="min-h-screen bg-gray-50 pb-20 font-sans">
      {renderHeader("Nouvelle Mission")}
      <div className="p-4 space-y-4">
        <div className="bg-white p-4 rounded-lg shadow-sm">
          <label className="block text-sm font-medium text-gray-700 mb-1">Nom du Client</label>
          <input 
            type="text" 
            className="w-full p-3 border rounded-lg"
            placeholder="Ex: ACME Corp"
            value={mission.clientName}
            onChange={e => setMission({...mission, clientName: e.target.value})}
          />
        </div>

        {/* GPS Section */}
        <div className="bg-white p-4 rounded-lg shadow-sm">
           <div className="flex justify-between items-center mb-2">
             <label className="block text-sm font-medium text-gray-700">Position du Site</label>
             {mission.gps && (
               <span className="text-xs text-green-600 font-bold bg-green-50 px-2 py-1 rounded">
                 Précision: ±{Math.round(mission.gps.accuracy)}m
               </span>
             )}
           </div>
           
           {!mission.gps ? (
             <button 
               onClick={getGPS}
               disabled={gpsLoading}
               className="w-full py-3 border-2 border-dashed border-blue-200 text-blue-600 rounded-lg font-bold flex justify-center items-center gap-2 hover:bg-blue-50 active:bg-blue-100"
             >
               {gpsLoading ? (
                 <span className="animate-pulse">Acquisition GPS...</span>
               ) : (
                 <><MapPin size={18}/> Obtenir Position GPS</>
               )}
             </button>
           ) : (
             <div className="p-3 bg-blue-50 rounded-lg flex justify-between items-center border border-blue-100">
               <div>
                 <div className="text-sm font-bold text-gray-800 flex items-center gap-1">
                   <MapPin size={14} className="text-blue-600"/> Position Enregistrée
                 </div>
                 <div className="text-xs text-gray-500 font-mono mt-1">
                   {mission.gps.lat.toFixed(5)}, {mission.gps.lng.toFixed(5)}
                 </div>
               </div>
               <button onClick={() => setMission({...mission, gps: null})} className="text-xs text-red-500 font-bold px-2 py-1">
                 Supprimer
               </button>
             </div>
           )}
        </div>

        <div className="bg-white p-4 rounded-lg shadow-sm">
          <label className="block text-sm font-medium text-gray-700 mb-1">Étage / Zone</label>
          <select 
            className="w-full p-3 border rounded-lg bg-white"
            value={mission.floor}
            onChange={e => setMission({...mission, floor: e.target.value})}
          >
            <option value="0">Rez-de-chaussée</option>
            <option value="1">1er Étage</option>
            <option value="2">2ème Étage</option>
            <option value="3">3ème Étage+</option>
          </select>
        </div>

        <div className="bg-white p-4 rounded-lg shadow-sm space-y-4">
          <h3 className="font-semibold text-gray-800">Accès & Logistique</h3>
          
          <div className="flex items-center justify-between">
            <span>Ascenseur utilisable ?</span>
            <button 
              onClick={() => setMission({...mission, elevator: !mission.elevator})}
              className={`px-4 py-2 rounded-lg font-bold ${mission.elevator ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
            >
              {mission.elevator ? 'OUI' : 'NON'}
            </button>
          </div>

          {/* New: Dimensions Ascenseur */}
          {mission.elevator && (
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
              <div className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1">
                <Ruler size={14}/> DIMENSIONS ASCENSEUR (cm)
              </div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <label className="text-xs text-gray-400">Largeur</label>
                  <input type="number" placeholder="ex: 80" className="w-full p-2 rounded border text-sm" 
                    value={mission.elevatorDims.w} 
                    onChange={e => setMission({...mission, elevatorDims: {...mission.elevatorDims, w: e.target.value}})} />
                </div>
                <div>
                  <label className="text-xs text-gray-400">Profondeur</label>
                  <input type="number" placeholder="ex: 120" className="w-full p-2 rounded border text-sm" 
                    value={mission.elevatorDims.d} 
                    onChange={e => setMission({...mission, elevatorDims: {...mission.elevatorDims, d: e.target.value}})} />
                </div>
                <div>
                  <label className="text-xs text-gray-400">Hauteur</label>
                  <input type="number" placeholder="ex: 210" className="w-full p-2 rounded border text-sm" 
                    value={mission.elevatorDims.h} 
                    onChange={e => setMission({...mission, elevatorDims: {...mission.elevatorDims, h: e.target.value}})} />
                </div>
                <div>
                  <label className="text-xs text-gray-400">Charge Max (kg)</label>
                  <input type="number" placeholder="ex: 630" className="w-full p-2 rounded border text-sm" 
                    value={mission.elevatorDims.weight} 
                    onChange={e => setMission({...mission, elevatorDims: {...mission.elevatorDims, weight: e.target.value}})} />
                </div>
              </div>
            </div>
          )}

          {!mission.elevator && (
            <div>
               <label className="text-sm">Nombre d'étages à pied</label>
               <input type="number" value={mission.stairs} onChange={e => setMission({...mission, stairs: e.target.value})} className="w-full p-2 border rounded" />
            </div>
          )}

          <div>
            <label className="text-sm block mb-2">Distance Stationnement Camion</label>
            <div className="flex gap-2">
              {['0-10m', '10-50m', '>50m'].map(opt => (
                <button
                  key={opt}
                  onClick={() => setMission({...mission, parkingDistance: opt})}
                  className={`flex-1 py-2 text-xs rounded border ${mission.parkingDistance === opt ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600'}`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button 
          onClick={() => setStep(2)}
          disabled={!mission.clientName}
          className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold shadow-lg disabled:opacity-50 flex justify-center items-center gap-2"
        >
          Commencer l'Inventaire <ArrowRight size={20}/>
        </button>
      </div>
    </div>
  );

  // ECRAN 2 : INVENTAIRE
  if (step === 2) return (
    <div className="min-h-screen bg-gray-50 pb-24 font-sans">
      {renderHeader(`${mission.clientName} - ${mission.floor}`)}
      
      {/* Catégories */}
      <div className="flex bg-white shadow-sm sticky top-14 z-10 overflow-x-auto">
        {[
          { id: 'furniture', label: 'Mobilier', icon: Box },
          { id: 'it', label: 'Info/Elec', icon: AlertTriangle },
          { id: 'boxes', label: 'Cartons', icon: Box },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-3 flex flex-col items-center text-xs font-medium border-b-2 ${activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}
          >
            <tab.icon size={18} className="mb-1"/>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Liste des items */}
      <div className="p-3 space-y-3">
        {ITEMS_DB[activeTab].map(item => {
          const count = inventory[item.id]?.count || 0;
          const trash = inventory[item.id]?.trash || 0;
          
          return (
            <div key={item.id} className="bg-white rounded-xl shadow-sm p-3 border border-gray-100">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="font-bold text-gray-800">{item.name}</h3>
                  <p className="text-xs text-gray-400">{item.vol} m³ / unité</p>
                </div>
                {(count > 0 || trash > 0) && (
                  <div className="text-xs font-bold bg-blue-50 text-blue-700 px-2 py-1 rounded">
                    Total: {count + trash}
                  </div>
                )}
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                {/* Section Déménagement */}
                <div className="bg-green-50 rounded-lg p-2">
                  <div className="text-center text-xs text-green-700 font-bold mb-1 flex items-center justify-center gap-1">
                    <Truck size={12}/> À Déménager
                  </div>
                  <div className="flex justify-between items-center">
                    <button 
                      className="w-8 h-8 rounded-full bg-white text-green-600 shadow flex items-center justify-center active:scale-90 transition"
                      onClick={() => updateItem(item.id, 'count', -1)}
                    >
                      <Minus size={16}/>
                    </button>
                    <span className="font-bold text-lg text-gray-800">{count}</span>
                    <button 
                      className="w-8 h-8 rounded-full bg-green-500 text-white shadow flex items-center justify-center active:scale-90 transition"
                      onClick={() => updateItem(item.id, 'count', 1)}
                    >
                      <Plus size={16}/>
                    </button>
                  </div>
                </div>

                {/* Section Déchetterie */}
                <div className="bg-red-50 rounded-lg p-2">
                  <div className="text-center text-xs text-red-700 font-bold mb-1 flex items-center justify-center gap-1">
                    <Trash2 size={12}/> Recyclage
                  </div>
                  <div className="flex justify-between items-center">
                    <button 
                      className="w-8 h-8 rounded-full bg-white text-red-600 shadow flex items-center justify-center active:scale-90 transition"
                      onClick={() => updateItem(item.id, 'trash', -1)}
                    >
                      <Minus size={16}/>
                    </button>
                    <span className="font-bold text-lg text-gray-800">{trash}</span>
                    <button 
                      className="w-8 h-8 rounded-full bg-red-500 text-white shadow flex items-center justify-center active:scale-90 transition"
                      onClick={() => updateItem(item.id, 'trash', 1)}
                    >
                      <Plus size={16}/>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200 flex gap-3">
         <button onClick={() => setStep(1)} className="px-4 py-3 rounded-lg border border-gray-300 text-gray-600 font-bold">Retour</button>
         <button onClick={() => setStep(3)} className="flex-1 py-3 rounded-lg bg-blue-600 text-white font-bold shadow-lg">Voir Synthèse</button>
      </div>
    </div>
  );

  // ECRAN 3 : SYNTHESE
  if (step === 3) return (
    <div className="min-h-screen bg-gray-50 pb-20 font-sans">
      {renderHeader("Synthèse & Estimation")}
      
      <div className="p-4 space-y-4">
        
        {/* Résumé Logistique */}
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="text-gray-500 text-sm font-bold uppercase mb-4">Estimation des moyens</h2>
          <div className="grid grid-cols-2 gap-4 text-center">
            <div className="p-3 bg-blue-50 rounded-lg">
              <Truck className="mx-auto text-blue-600 mb-2" />
              <div className="text-2xl font-bold text-gray-800">{stats.moveVol.toFixed(1)} <span className="text-sm font-normal">m³</span></div>
              <div className="text-xs text-gray-500">Volume Déménagement</div>
            </div>
            <div className="p-3 bg-red-50 rounded-lg">
              <Trash2 className="mx-auto text-red-500 mb-2" />
              <div className="text-2xl font-bold text-gray-800">{stats.trashVol.toFixed(1)} <span className="text-sm font-normal">m³</span></div>
              <div className="text-xs text-gray-500">Volume Déchetterie</div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-4 text-center">
            <div>
              <div className="text-xl font-bold text-gray-800">{stats.manDays}</div>
              <div className="text-xs text-gray-500">Jours-Hommes estimés</div>
            </div>
            <div>
               <div className="text-xl font-bold text-gray-800">{stats.trucks20}</div>
               <div className="text-xs text-gray-500">Camions (20m³)</div>
            </div>
          </div>
          
          <div className="mt-2 space-y-1">
            {mission.elevator && mission.elevatorDims.w && (
              <div className="p-2 bg-yellow-50 text-xs text-yellow-800 rounded border border-yellow-200 text-center flex items-center justify-center gap-1">
                 <Ruler size={12}/> Ascenseur : {mission.elevatorDims.w}x{mission.elevatorDims.d}x{mission.elevatorDims.h}cm
              </div>
            )}
            
            {mission.gps && (
              <a 
                href={`https://www.google.com/maps/search/?api=1&query=${mission.gps.lat},${mission.gps.lng}`}
                target="_blank"
                rel="noreferrer" 
                className="block p-2 bg-blue-50 text-xs text-blue-800 rounded border border-blue-200 text-center flex items-center justify-center gap-1 hover:bg-blue-100"
              >
                 <MapPin size={12}/> Voir Position sur la carte <ExternalLink size={10}/>
              </a>
            )}
          </div>
        </div>

        {/* New: Notes & Vocal */}
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="text-gray-500 text-sm font-bold uppercase mb-2">Notes & Observations</h2>
          
          <textarea 
            className="w-full border rounded p-2 text-sm mb-3"
            rows="3"
            placeholder="Détails accès, codes portes, fragilité..."
            value={mission.comments}
            onChange={e => setMission({...mission, comments: e.target.value})}
          />

          <div className="border-t pt-3">
             <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-bold text-gray-700">Notes Vocales</span>
                {!isRecording ? (
                  <button 
                    onClick={startRecording}
                    className="flex items-center gap-2 bg-red-100 text-red-600 px-3 py-1 rounded-full text-xs font-bold active:bg-red-200"
                  >
                    <Mic size={14}/> Enregistrer
                  </button>
                ) : (
                  <button 
                    onClick={stopRecording}
                    className="flex items-center gap-2 bg-red-600 text-white px-3 py-1 rounded-full text-xs font-bold animate-pulse"
                  >
                    <StopCircle size={14}/> Stop
                  </button>
                )}
             </div>

             <div className="space-y-2">
                {mission.voiceNotes.map((note, index) => (
                  <div key={note.id} className="flex justify-between items-center bg-gray-50 p-2 rounded">
                    <div className="flex items-center gap-2">
                      <button onClick={() => playVoiceNote(note.data)} className="bg-white border p-1 rounded-full shadow-sm text-blue-600">
                        <Play size={12}/>
                      </button>
                      <span className="text-xs text-gray-500">Note vocale #{index + 1}</span>
                    </div>
                    <button onClick={() => deleteVoiceNote(note.id)} className="text-gray-400 hover:text-red-500">
                      <X size={14}/>
                    </button>
                  </div>
                ))}
                {mission.voiceNotes.length === 0 && (
                  <div className="text-xs text-gray-400 italic text-center py-2">Aucune note vocale enregistrée.</div>
                )}
             </div>
          </div>
        </div>

        {/* Détail Inventaire */}
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <h2 className="text-gray-500 text-sm font-bold uppercase p-4 bg-gray-50 border-b">Liste des éléments</h2>
          {Object.entries(inventory).length === 0 ? (
            <div className="p-4 text-center text-gray-400">Aucun élément saisi.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {Object.entries(inventory).map(([id, data]) => {
                const itemDef = Object.values(ITEMS_DB).flat().find(i => i.id === id);
                if (!itemDef) return null;
                return (
                  <li key={id} className="p-3 flex justify-between items-center text-sm">
                    <span>{itemDef.name}</span>
                    <div className="flex gap-2">
                      {data.count > 0 && <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded-full text-xs font-bold">{data.count} Dém.</span>}
                      {data.trash > 0 && <span className="bg-red-100 text-red-800 px-2 py-0.5 rounded-full text-xs font-bold">{data.trash} Recy.</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Actions */}
        <button 
          onClick={handleSubmit}
          disabled={loading}
          className={`w-full py-4 rounded-xl font-bold shadow-lg text-white flex justify-center items-center gap-2 ${loading ? 'bg-gray-400' : 'bg-green-600 hover:bg-green-700'}`}
        >
          {loading ? 'Envoi en cours...' : <><Save size={20}/> Valider l'inventaire</>}
        </button>

        <button 
          onClick={() => setStep(2)}
          className="w-full py-3 text-gray-500 font-medium"
        >
          Retour à la saisie
        </button>

      </div>
    </div>
  );
}
