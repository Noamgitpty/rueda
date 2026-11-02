// Emplacement réservé : la commande existe pour figer son nom (handoff §7) ;
// la story indiquée la remplira. Sort avec le code 0 pour ne pas bloquer la CI.
const [command = '?', story = '?'] = process.argv.slice(2);
console.log(`${command} : pas encore implémenté (${story})`);
