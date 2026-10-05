#!/bin/bash
sed -i "s/import { WelcomeScreen } from '.\/screens\/WelcomeScreen';/import { WelcomeScreen, BusinessAuthSession } from '.\/screens\/WelcomeScreen';\nimport { FirstTimeSetupWizard } from '.\/screens\/FirstTimeSetupWizard';\nimport { RoleLoginModal } from '.\/components\/RoleLoginModal';/" src/App.tsx

sed -i "s/const \[session, setSession\] = useState<UserSession | null>(null);/const [businessAuth, setBusinessAuth] = useState<BusinessAuthSession | null>(null);\n  const [session, setSession] = useState<UserSession | null>(null);\n  const [showSetupWizard, setShowSetupWizard] = useState(false);\n  const [branches, setBranches] = useState<Branch[]>(INITIAL_BRANCHES);/" src/App.tsx

