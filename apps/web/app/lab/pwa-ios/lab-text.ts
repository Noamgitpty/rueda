/**
 * Textes du laboratoire, en français : la page s'adresse au fondateur et aux testeurs, pas aux
 * clients (prototype jetable, seule exception de 19 US-026). Regroupés ici, hors des composants ;
 * le catalogue i18n es / en arrive avec US-014.
 */
import type { LabTestId } from './report';

export const LAB_TEXT = {
  title: 'Laboratoire PWA iOS (US-026)',
  intro:
    'Faites les tests dans l’ordre du protocole docs/qa/US-026-protocole-pwa-ios.md. Chaque bouton affiche un résultat JSON : copiez le rapport complet à la fin et joignez-le à la grille.',
  insecure:
    'Attention : page ouverte sans HTTPS. Caméra en direct, service worker, géolocalisation et chiffrement sont bloqués par le navigateur. Seuls les tests d’entrée fichier et d’installation ont un sens ici.',
  copy: 'Copier',
  copied: 'Copié',
  copyFailed: 'Copie impossible : sélectionnez le texte à la main',
  copyAll: 'Copier le rapport complet',
  clearAll: 'Effacer les résultats',
  run: 'Lancer',
  notRun: 'Pas encore lancé.',
} as const;

export const TEST_TEXT: Record<LabTestId, { title: string; hint: string }> = {
  environment: {
    title: '1. Environnement',
    hint: 'Relevé automatique : HTTPS, mode installé, API disponibles. Notez aussi la version d’iOS lue dans Réglages > Général > Informations.',
  },
  'camera-live': {
    title: '2. Caméra en direct (chemin retenu)',
    hint: 'Ouvre la caméra arrière dans la page, sans sélecteur de fichier. Aucune photothèque ne doit apparaître. Prenez une photo, vérifiez taille et poids.',
  },
  'file-input': {
    title: '3. Entrée fichier « capture » (chemin à risque)',
    hint: 'Bouton de fichier classique. Notez si iOS propose la photothèque. Essayez de choisir une ANCIENNE photo : le test doit la signaler.',
  },
  'storage-persist': {
    title: '4. Stockage persistant',
    hint: 'Demande au navigateur de ne pas purger le stockage, et affiche le quota.',
  },
  'storage-marker': {
    title: '5. Purge du stockage (témoin daté)',
    hint: 'Jour 0 : « Écrire le témoin ». Revenir au moins 8 jours plus tard sans ouvrir la page entre-temps, puis « Lire le témoin ».',
  },
  'offline-queue': {
    title: '6. File hors ligne chiffrée',
    hint: 'Ajoute la dernière photo (ou un fichier test) à la file. Fermez l’application, rouvrez-la, puis « Lister » : les éléments doivent être là, empreinte vérifiée.',
  },
  geolocation: {
    title: '7. Géolocalisation',
    hint: 'Autorisez la position quand iOS le demande. Notez la précision (mètres) et le délai.',
  },
  'service-worker': {
    title: '8. Service worker et réouverture hors ligne',
    hint: 'Enregistrez, rechargez une fois, puis passez en mode avion et rechargez : la page doit s’afficher.',
  },
  'background-sync': {
    title: '9. Synchronisation en arrière-plan',
    hint: 'Attendu sur iOS : non disponible. Le test le confirme.',
  },
  install: {
    title: '10. Installation sur l’écran d’accueil',
    hint: 'Dans Safari : Partager > Sur l’écran d’accueil. Ouvrez ensuite la page depuis l’icône et relancez ce test.',
  },
};
