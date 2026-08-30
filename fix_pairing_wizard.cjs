const fs = require('fs');
let content = fs.readFileSync('src/components/DevicePairingWizard.tsx', 'utf8');

content = content.replace(
  "type ConnectMethod = 'WIFI' | 'QR' | 'BLUETOOTH';",
  "type ConnectMethod = 'WIFI' | 'QR' | 'BLUETOOTH' | 'CODE';"
);

const newMethodStr = `            <button
              onClick={() => {
                setSelectedMethod('QR');
                setStep(3);
              }}
              className="p-3 bg-slate-900 border border-slate-700 hover:border-slate-500 rounded-xl text-left transition space-y-1 group"
            >
              <div className="flex items-center gap-2 text-white font-bold text-xs">
                <QrCode className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" /> 
                Show QR Code
              </div>
              <div className="text-[10px] text-slate-400">
                Display certificate QR for camera scanning.
              </div>
            </button>
            <button
              onClick={() => {
                setSelectedMethod('CODE');
                setStep(3);
              }}
              className="p-3 bg-slate-900 border border-slate-700 hover:border-slate-500 rounded-xl text-left transition space-y-1 group"
            >
              <div className="flex items-center gap-2 text-white font-bold text-xs">
                <KeyRound className="w-4 h-4 text-amber-400 group-hover:scale-110 transition-transform" /> 
                6-Digit Code
              </div>
              <div className="text-[10px] text-slate-400">
                Generate a temporary pairing code.
              </div>
            </button>`;

content = content.replace(
  `            <button
              onClick={() => {
                setSelectedMethod('QR');
                setStep(3);
              }}
              className="p-3 bg-slate-900 border border-slate-700 hover:border-slate-500 rounded-xl text-left transition space-y-1 group"
            >
              <div className="flex items-center gap-2 text-white font-bold text-xs">
                <QrCode className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" /> 
                Show QR Code
              </div>
              <div className="text-[10px] text-slate-400">
                Display certificate QR for camera scanning.
              </div>
            </button>`,
  newMethodStr
);

const newStep3Str = `      {/* STEP 3: CODE Display */}
      {step === 3 && selectedMethod === 'CODE' && (
        <div className="space-y-6 text-center py-6">
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-white">Temporary Pairing Code</h3>
            <p className="text-xs text-slate-300 max-w-sm mx-auto">
              Enter this code on the new device's Welcome screen.
            </p>
          </div>
          
          <div className="py-8 bg-slate-950 border-2 border-slate-800 rounded-2xl">
            <span className="text-5xl font-mono font-black tracking-[0.5em] text-amber-500">
              {Math.floor(100000 + Math.random() * 900000)}
            </span>
          </div>
          
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => setStep(2)}
              className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl transition"
            >
              Back
            </button>
            <button
              onClick={() => onClose()}
              className="px-6 py-3 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-xl transition"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Bluetooth status */}`;

content = content.replace(
  "{/* STEP 3: Bluetooth status */}",
  newStep3Str
);

fs.writeFileSync('src/components/DevicePairingWizard.tsx', content);
