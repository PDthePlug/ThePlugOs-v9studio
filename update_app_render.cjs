const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf8');

const targetStr = `{/* Role Authentication Modal - shown when session locked or not authenticated */}
      {!session && (
        <WelcomeScreen onLoginSuccess={handleLoginSuccess} />
      )}

      {session && (
        <>`;

const replacementStr = `{/* 1. If not authenticated with business, show WelcomeScreen (Cloud/Pair Auth) */}
      {!businessAuth && (
        <WelcomeScreen onLoginSuccess={handleBusinessAuthSuccess} />
      )}
      
      {/* 2. If business authenticated but setup needed */}
      {businessAuth && showSetupWizard && (
        <FirstTimeSetupWizard 
          businessAuth={{ businessId: businessAuth.businessId, branchId: 'br-main', isOwner: businessAuth.isOwner }}
          onComplete={async () => {
            // Setup complete, trigger reload of staff
            try {
              const staff = await sdk.storage.get('staff', 'directory');
              if (Array.isArray(staff)) setStaffList(staff);
            } catch(e) {}
            setShowSetupWizard(false);
          }}
        />
      )}

      {/* 3. If business authenticated, setup complete, but no terminal session */}
      {businessAuth && !showSetupWizard && !session && (
        <RoleLoginModal
          onLoginSuccess={handleTerminalLoginSuccess}
          currentSession={null}
          staffList={staffList}
          branches={branches}
        />
      )}

      {/* 4. OS Workspace */}
      {businessAuth && !showSetupWizard && session && (
        <>`;

content = content.replace(targetStr, replacementStr);

fs.writeFileSync('src/App.tsx', content);
