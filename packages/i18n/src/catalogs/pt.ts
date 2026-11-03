import type { MessageKey } from './es.ts';
import type { Message } from './types.ts';

/**
 * Catalogue portugais du Brésil (pt-BR, DEC-FONDATEUR-18), aligné clé pour clé sur `es.ts` (qui
 * fait foi). Le `satisfies` fait échouer `pnpm typecheck` si une clé manque ou est en trop.
 *
 * Variante : **portugais du Brésil** (Paraguay voisin du Brésil), jamais le portugais européen
 * (« carro », « celular », « tela », « cadastro », pas « telemóvel » ni « ecrã »). Registre :
 * **« você »** dans l'interface, impératif courant du Brésil (« Digite », « Confira ») ; les
 * textes contractuels et juridiques restent formels et sont relus par l'avocat avant la mise en
 * service. Réécrit pour sonner naturel, pas traduit mot à mot ; aucun texte repris de Turo.
 *
 * Pluriels (CLDR du portugais, `Intl.PluralRules('pt-BR')`) : `one` couvre 0 et 1 (« 0 dia »,
 * « 1 dia »), `other` le reste ; la catégorie `many` (1 000 000) se replie sur `other`.
 */
export const PT_MESSAGES = {
  'common.locale.switchLabel': 'Idioma',
  'common.locale.current': 'Idioma atual: {language}',
  'common.price.finalForDays': {
    one: 'Preço final · {count} dia',
    other: 'Preço final · {count} dias',
  },
  'common.auth.sessionRequired': 'Sua sessão expirou. Entre de novo.',
  'common.auth.invalidCredentials': 'E-mail ou senha incorretos.',
  'common.auth.emailInvalid': 'Digite um e-mail válido.',
  'common.auth.passwordWeak': 'A senha precisa ter pelo menos {min} caracteres.',
  'common.auth.termsNotAccepted':
    'Para continuar, aceite os Termos de Uso e a Política de Privacidade.',
  'common.auth.linkExpired': 'Este link não vale mais. Peça um novo.',
  'common.auth.rateLimited': 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  'common.auth.requestInvalid': 'Confira os dados informados.',
  'common.auth.signupAccepted': 'Confira seu e-mail para continuar.',
  'common.auth.emailVerified': 'Seu e-mail foi confirmado.',
  'web.home.tagline': 'Alugue um carro e saiba o preço final desde o começo.',
  'backoffice.meta.title': '{brand} — painel administrativo',
  'backoffice.meta.description': 'Painel interno.',
  'backoffice.home.heading': '{brand} — painel administrativo',
  'backoffice.home.intro': 'Painel interno da equipe.',
  'common.offline.banner': 'Você está sem internet. Mostramos as últimas informações salvas.',
  'common.error.server':
    'Algo deu errado do nosso lado. Nada do que você digitou foi perdido. Tente de novo; se continuar, fale com a gente pelo WhatsApp informando o código {code}.',
  'common.price.perDay': '{amount} por dia',
  'common.price.details': 'Detalhes do preço',
  'common.price.total': 'Total',
  'common.ui.loading': 'Carregando…',
  'common.ui.optional': '(opcional)',
  'common.ui.errorSummary.title': {
    one: 'Confira {count} campo',
    other: 'Confira {count} campos',
  },
  'common.ui.error.code': 'Código: {code}',
  'common.ui.rating.label': 'Nota: {rating} de 5',
  'common.ui.rating.trips': { one: '{count} viagem', other: '{count} viagens' },
  'common.ui.distance': 'A {distance} km',
  'common.ui.car.save': 'Salvar {car}',
  'common.ui.steps.progress': 'Etapa {current} de {total}',
  'common.ui.steps.done': 'concluída',
  'common.ui.host.since': 'Membro desde {year}',
  'common.ui.host.responseRate': 'Taxa de resposta: {rate}%',
  'common.ui.host.responseTime': {
    one: 'Costuma responder em até {count} hora',
    other: 'Costuma responder em até {count} horas',
  },
  'common.ui.photo.take': 'Tirar foto: {angle}',
  'common.ui.photo.retake': 'Tirar de novo: {angle}',
  'common.ui.photo.empty': 'Nenhuma foto ainda',
  'common.ui.photo.saved': 'Salva neste celular',
  'common.ui.photo.uploading': 'Enviando…',
  'common.ui.photo.uploaded': 'Enviada',
  'common.ui.photo.failed': 'Ainda não foi enviada. Vamos tentar de novo.',
  'web.common.save': 'Salvar',
  'web.s01.owner.cta': 'Anuncie seu carro',
  'web.s02.new': 'Novo',
  'web.s02.empty': 'Nenhum carro disponível nessas datas.',
  'web.s03.cta': 'Reservar',
  'web.s03.host.titleMasc': 'Seu anfitrião',
  'web.s03.host.titleFem': 'Sua anfitriã',
  'web.s03.host.titleNeutral': 'Quem aluga o carro para você',
  'web.host.guest.verified': 'Identidade verificada',
  'web.s03.deposit.title': 'Caução',
  'web.deposit.amount': 'Valor',
  'web.deposit.holder':
    'O valor fica bloqueado no seu cartão por {merchant_name}; {host_name} nunca recebe esse dinheiro.',
  'web.deposit.how.preauth': 'É um bloqueio temporário no seu cartão, não uma cobrança.',
  'web.deposit.how.chargeRefund': 'O valor é cobrado no início e devolvido no final.',
  'web.deposit.covers':
    'Cobre somente estes custos da viagem: combustível faltando, atraso na devolução, quilômetros a mais, limpeza, cigarro ou animais, e pedágios.',
  'web.deposit.notCovers': 'Danos nunca são descontados desta caução.',
  'web.deposit.releaseBy': 'É liberada até {date}, no máximo.',
  'web.deposit.contest': 'Conferir e responder',
  'web.deposit.debitWarning':
    'A caução é cobrada e depois devolvida. Faremos o estorno em {date}; seu banco pode levar de 3 a 10 dias úteis para mostrar o valor.',
  'web.catalog.title': 'Biblioteca de componentes',
  'web.catalog.intro':
    'Cada componente em todos os seus estados. Escolha o idioma, o tema e a largura para revisar.',
  'web.catalog.controls.theme': 'Tema',
  'web.catalog.controls.auto': 'Automático',
  'web.catalog.controls.light': 'Claro',
  'web.catalog.controls.dark': 'Escuro',
  'web.catalog.controls.width': 'Largura',
  'web.catalog.controls.mobile': 'Celular, 360 px',
  'web.catalog.controls.full': 'Largura total',
  'web.catalog.state.normal': 'Normal',
  'web.catalog.state.empty': 'Vazio',
  'web.catalog.state.loading': 'Carregando',
  'web.catalog.state.error': 'Com erro',
  'web.catalog.state.disabled': 'Desativado',
  'web.catalog.section.buttons': 'Botões',
  'web.catalog.section.fields': 'Campos de formulário',
  'web.catalog.section.badges': 'Selos, notas e avatares',
  'web.catalog.section.price': 'Preço final',
  'web.catalog.section.carCard': 'Card do carro',
  'web.catalog.section.host': 'Bloco do anfitrião',
  'web.catalog.section.deposit': 'Bloco da caução',
  'web.catalog.section.banners': 'Avisos',
  'web.catalog.section.steps': 'Etapas',
  'web.catalog.section.photo': 'Captura de fotos',
  'web.catalog.section.table': 'Tabelas do painel',
  'web.catalog.sample.emailLabel': 'Endereço de e-mail',
  'web.catalog.sample.emailHint': 'Vamos mandar a confirmação da sua reserva para este endereço.',
  'web.catalog.sample.nameLabel': 'Nome',
  'web.catalog.sample.terms': 'Li e aceito os Termos de Uso e a Política de Privacidade.',
  'web.catalog.sample.step.dates': 'Datas',
  'web.catalog.sample.step.identity': 'Identidade',
  'web.catalog.sample.step.payment': 'Pagamento',
  'web.catalog.sample.step.confirmation': 'Confirmação',
  'web.catalog.sample.line.rent': {
    one: 'Aluguel · {count} dia',
    other: 'Aluguel · {count} dias',
  },
  'web.catalog.sample.line.tripFee': 'Taxa da viagem',
  'web.catalog.sample.line.protection': 'Proteção básica',
  'web.catalog.sample.line.tax': 'Impostos',
  'web.catalog.sample.table.caption': 'Próximas entregas',
  'web.catalog.sample.table.trip': 'Viagem',
  'web.catalog.sample.table.dates': 'Datas',
  'web.catalog.sample.table.status': 'Status',
  'web.catalog.sample.table.earnings': 'Seus ganhos',
  'web.catalog.sample.table.confirmed': 'Confirmada',
  'web.catalog.sample.table.pending': 'Pendente',
  'web.catalog.sample.table.empty': 'Você ainda não tem entregas.',
  'web.catalog.sample.photo.front': 'Frente',
  'web.catalog.sample.photo.rear': 'Traseira',
  'web.catalog.sample.photo.driverSide': 'Lado do motorista',
  'web.catalog.sample.photo.passengerSide': 'Lado do passageiro',
  'web.catalog.sample.photo.dashboard': 'Painel',
  'web.catalog.sample.hostQuote': 'Entrego o carro limpo e com o tanque cheio.',
  'web.catalog.sample.retry': 'Tentar de novo',
  'common.auth.forbidden': 'Você não tem permissão para esta ação. A tentativa foi registrada.',
  'common.auth.twoFactorRequired': 'Confirme sua identidade com o código do seu app autenticador.',
  'common.auth.totpInvalid': 'Código inválido. Use o código que aparece agora no seu app.',
  'common.auth.totpLocked':
    'Muitos códigos errados. Aguarde 15 minutos ou peça a um administrador para redefinir seu acesso.',
  'common.auth.mfaUnavailable':
    'A verificação em duas etapas está indisponível no momento. Nenhum acesso foi liberado.',
  'common.auth.actionUnavailable':
    'Esta ação ainda não está disponível no painel. A tentativa foi registrada.',
  'common.auth.actionRecorded': 'Ação registrada.',
  'common.auth.actionDone': 'Pronto. A alteração foi registrada.',
  'backoffice.login.heading': 'Acesso da equipe',
  'backoffice.login.email': 'Endereço de e-mail',
  'backoffice.login.password': 'Senha',
  'backoffice.login.submit': 'Entrar',
  'backoffice.totp.heading': 'Verificação em duas etapas',
  'backoffice.totp.intro': 'Digite o código de 6 dígitos que aparece no seu app autenticador.',
  'backoffice.totp.code': 'Código de 6 dígitos',
  'backoffice.totp.submit': 'Verificar',
  'backoffice.enroll.heading': 'Ative sua verificação em duas etapas',
  'backoffice.enroll.intro':
    'Um administrador passou para você um código de ativação. Digite o código para ver a chave do seu app autenticador.',
  'backoffice.enroll.enrollmentCode': 'Código de ativação',
  'backoffice.enroll.reveal': 'Mostrar a chave',
  'backoffice.enroll.secret': 'Chave para o seu app (aparece uma única vez)',
  'backoffice.enroll.openApp': 'Abrir no meu app autenticador',
  'backoffice.enroll.confirm': 'Ativar',
  'backoffice.denied.heading': 'Acesso negado',
  'backoffice.denied.notStaff': 'Sua conta não tem nenhuma função da equipe interna.',
  'backoffice.denied.noTotp':
    'Sua conta da equipe não tem verificação em duas etapas. Peça um código de ativação a um administrador.',
  'backoffice.console.roles': 'Suas funções',
  'backoffice.console.countries': 'Cobertura · {countries}',
  'backoffice.console.signOut': 'Sair',
  'backoffice.role.SUPPORT_AGENT': 'Suporte',
  'backoffice.role.OPS_AGENT': 'Operações',
  'backoffice.role.FINANCE': 'Finanças',
  'backoffice.role.ADMIN': 'Administrador',
  'backoffice.role.SUPERADMIN': 'Superadministrador',
  'backoffice.journal.caption': 'Histórico de atividades',
  'backoffice.journal.when': 'Data e hora',
  'backoffice.journal.who': 'Quem',
  'backoffice.journal.action': 'Ação',
  'backoffice.journal.subject': 'Referente a',
  'backoffice.journal.empty': 'Nenhuma atividade registrada até agora.',
  'backoffice.action.heading': 'Ação em uma viagem',
  'backoffice.action.subject': 'Identificador da viagem',
  'backoffice.action.reason': 'Motivo',
  'backoffice.action.reasonHint': 'De 10 a 1.000 caracteres. Fica guardado no histórico.',
  'backoffice.action.CANCEL_TRIP_PLATFORM': 'Cancelar em nome da plataforma',
  'backoffice.action.DECLARE_NO_SHOW': 'Registrar não comparecimento',
  'backoffice.action.RECORD_CLAIM': 'Registrar uma reclamação',
  'backoffice.error.network':
    'Não foi possível conectar ao servidor. Confira sua conexão e tente de novo.',
  'backoffice.journal.error': 'Não foi possível carregar o histórico de atividades.',
  'backoffice.journal.scope': 'Você só vê as ações dentro do alcance das suas funções.',
  // Gabarits de notification (US-021, NTF-001 ; catalogue réduit de la bêta). PROPOSÉS : à
  // reporter dans 10b §4.3 et à relire par l'UX. Variables nommées, identiques dans les quatre langues.
  'ntf.kycApproved.email.subject': 'Sua identidade foi verificada · {brand}',
  'ntf.kycApproved.email.body':
    'Olá, {first_name}. Verificamos sua identidade: agora você já pode reservar carros na {brand}.',
  'ntf.kycApproved.sms.body':
    '{brand}: {first_name}, sua identidade foi verificada. Você já pode reservar.',
  'ntf.bookingConfirmed.email.subject': 'Reserva {booking_ref} confirmada',
  'ntf.bookingConfirmed.email.body':
    'Olá, {first_name}. Sua reserva {booking_ref} está confirmada: de {start_at} a {end_at}. No app, você encontra o local de entrega, o contrato e as mensagens da reserva.',
  'ntf.bookingConfirmed.sms.body':
    '{brand}: reserva {booking_ref} confirmada, de {start_at} a {end_at}. Detalhes no app.',
  'ntf.bookingCancelled.email.subject': 'Reserva {booking_ref} cancelada',
  'ntf.bookingCancelled.email.body':
    'Olá, {first_name}. A reserva {booking_ref} foi cancelada. No app, você vê os detalhes e, se for o caso, o seu reembolso.',
  'ntf.bookingCancelled.sms.body':
    '{brand}: a reserva {booking_ref} foi cancelada. Detalhes no app.',
  'ntf.tripOverdue.email.subject': 'Reserva {booking_ref}: devolução atrasada',
  'ntf.tripOverdue.email.body':
    'Olá, {first_name}. O carro da reserva {booking_ref} deveria ter sido devolvido em {end_at}, e a devolução ainda não foi registrada. Fale com a outra parte pelas mensagens da reserva.',
  'ntf.tripOverdue.sms.body':
    '{brand}: devolução atrasada da reserva {booking_ref}, prevista para {end_at}. Fale pelas mensagens do app.',
  'ntf.payoutSent.email.subject': 'Seu repasse de {amount} foi enviado',
  'ntf.payoutSent.email.body':
    'Olá, {first_name}. Enviamos o seu repasse de {amount}. O banco pode levar algum tempo para creditar o valor. Os detalhes estão em seus ganhos.',
  'ntf.payoutSent.sms.body':
    '{brand}: enviamos um repasse de {amount} para você. Detalhes em seus ganhos.',
  'ntf.payoutOnHold.email.subject': 'Seu repasse de {amount} está retido',
  'ntf.payoutOnHold.email.body':
    'Olá, {first_name}. Seu repasse de {amount} está retido por enquanto. Em seus ganhos, você vê o motivo e o que fazer.',
  'ntf.payoutOnHold.sms.body':
    '{brand}: seu repasse de {amount} está retido. Veja o motivo em seus ganhos.',
  'common.brand.tokensInvalid': 'O formato do tema é inválido. Confira os valores indicados.',
  'common.brand.fontNotApproved': 'A fonte {font} não está na lista aprovada.',
  'common.brand.contrastInsufficient':
    'Não publicado: o par {pair} não atinge o contraste WCAG 2.2 AA.',
  'common.brand.versionNotFound': 'Esta versão não existe.',
  'common.brand.versionUnavailable':
    'O tema publicado está indisponível; o tema padrão está sendo exibido.',
  'common.brand.versionConflict': 'Esta versão já foi alterada. Recarregue e tente de novo.',
  'common.brand.assetInvalid':
    'Arquivo inválido: PNG, JPEG ou WebP (WOFF2 para fonte), texto alternativo em espanhol, inglês, francês e português, e licença informada.',
  'common.brand.assetUnavailable':
    'O armazenamento de arquivos está indisponível. Tente de novo mais tarde.',
  'common.brand.contentLocaleMissing':
    'Falta o texto em {locale}: um bloco é publicado em espanhol, inglês, francês e português.',
  'common.brand.contentKeyForbidden': 'Os textos jurídicos não são editados aqui.',
  'common.brand.contentMarkdownForbidden':
    'O texto contém HTML ou um link externo. Só são permitidos links internos.',
  'common.brand.contentNotFound': 'Este bloco ou esta versão não existe.',
  // Règles photo d'US-031 (ADR-069 point 7), versées depuis
  // `packages/design-tokens/rules/photo.messages.json` sans changer clés ni textes (ADR-071) ;
  // un test de `packages/i18n` vérifie que les deux restent identiques.
  'web.photo.angle.extFront.hint':
    'De frente, uns três passos para trás, com o para-choque inteiro na foto.',
  'web.photo.angle.extFront.label': 'Frente',
  'web.photo.angle.extFront34Driver.hint':
    'Do canto dianteiro do motorista: aparecem a frente e a lateral.',
  'web.photo.angle.extFront34Driver.label': 'Frente, lado do motorista',
  'web.photo.angle.extFront34Passenger.hint':
    'Do canto dianteiro do passageiro: aparecem a frente e a lateral.',
  'web.photo.angle.extFront34Passenger.label': 'Frente, lado do passageiro',
  'web.photo.angle.extProfileDriver.hint':
    'A lateral inteira do motorista, de roda a roda, a partir do meio.',
  'web.photo.angle.extProfileDriver.label': 'Perfil do motorista',
  'web.photo.angle.extProfilePassenger.hint':
    'A lateral inteira do passageiro, de roda a roda, a partir do meio.',
  'web.photo.angle.extProfilePassenger.label': 'Perfil do passageiro',
  'web.photo.angle.extRear.hint':
    'De frente para o porta-malas, com o para-choque traseiro inteiro.',
  'web.photo.angle.extRear.label': 'Traseira',
  'web.photo.angle.extRear34Driver.hint':
    'Do canto traseiro do motorista: aparecem a traseira e a lateral.',
  'web.photo.angle.extRear34Driver.label': 'Traseira, lado do motorista',
  'web.photo.angle.extRear34Passenger.hint':
    'Do canto traseiro do passageiro: aparecem a traseira e a lateral.',
  'web.photo.angle.extRear34Passenger.label': 'Traseira, lado do passageiro',
  'web.photo.angle.extSideDriverFront.hint':
    'Porta dianteira, para-lama e retrovisor do motorista.',
  'web.photo.angle.extSideDriverFront.label': 'Lateral do motorista, metade da frente',
  'web.photo.angle.extSideDriverRear.hint': 'Porta traseira e para-lama traseiro do motorista.',
  'web.photo.angle.extSideDriverRear.label': 'Lateral do motorista, metade de trás',
  'web.photo.angle.extSidePassengerFront.hint':
    'Porta dianteira, para-lama e retrovisor do passageiro.',
  'web.photo.angle.extSidePassengerFront.label': 'Lateral do passageiro, metade da frente',
  'web.photo.angle.extSidePassengerRear.hint': 'Porta traseira e para-lama traseiro do passageiro.',
  'web.photo.angle.extSidePassengerRear.label': 'Lateral do passageiro, metade de trás',
  'web.photo.angle.extWheelDriverFront.hint': 'De perto: a roda inteira, aro e pneu.',
  'web.photo.angle.extWheelDriverFront.label': 'Roda dianteira do motorista',
  'web.photo.angle.extWheelDriverRear.hint': 'De perto: a roda inteira, aro e pneu.',
  'web.photo.angle.extWheelDriverRear.label': 'Roda traseira do motorista',
  'web.photo.angle.extWheelPassengerFront.hint': 'De perto: a roda inteira, aro e pneu.',
  'web.photo.angle.extWheelPassengerFront.label': 'Roda dianteira do passageiro',
  'web.photo.angle.extWheelPassengerRear.hint': 'De perto: a roda inteira, aro e pneu.',
  'web.photo.angle.extWheelPassengerRear.label': 'Roda traseira do passageiro',
  'web.photo.angle.extWindshieldRoof.hint':
    'Levante um pouco o celular: o para-brisa inteiro e, se der, o teto.',
  'web.photo.angle.extWindshieldRoof.label': 'Para-brisa e teto',
  'web.photo.angle.gaugeFuel.hint':
    'Motor ligado: o nível de combustível ou de bateria aparece com clareza.',
  'web.photo.angle.gaugeFuel.label': 'Combustível ou carga',
  'web.photo.angle.gaugeOdometer.hint':
    'Motor ligado: todos os números do hodômetro estão legíveis.',
  'web.photo.angle.gaugeOdometer.label': 'Hodômetro',
  'web.photo.angle.intCenterConsole.hint': 'Câmbio, tela e porta-copos, de perto.',
  'web.photo.angle.intCenterConsole.label': 'Console central',
  'web.photo.angle.intDashboard.hint': 'Do meio do banco de trás: o painel e o volante inteiros.',
  'web.photo.angle.intDashboard.label': 'Painel',
  'web.photo.angle.intDriverSeat.hint':
    'Porta aberta: banco, assoalho e forro da porta do motorista.',
  'web.photo.angle.intDriverSeat.label': 'Banco do motorista',
  'web.photo.angle.intFrontSeats.hint':
    'Com a porta do motorista aberta: os dois bancos da frente.',
  'web.photo.angle.intFrontSeats.label': 'Bancos dianteiros',
  'web.photo.angle.intHeadliner.hint':
    'Aponte para cima a partir do banco da frente: teto e retrovisor interno.',
  'web.photo.angle.intHeadliner.label': 'Teto interno',
  'web.photo.angle.intPassengerSeat.hint':
    'Porta aberta: banco, assoalho e forro da porta do passageiro.',
  'web.photo.angle.intPassengerSeat.label': 'Banco do passageiro',
  'web.photo.angle.intRearSeats.hint': 'Com uma porta traseira aberta: o banco de trás inteiro.',
  'web.photo.angle.intRearSeats.label': 'Banco traseiro',
  'web.photo.angle.intRearSeatsDriver.hint':
    'Porta traseira do motorista aberta: banco, assoalho e forro.',
  'web.photo.angle.intRearSeatsDriver.label': 'Atrás, lado do motorista',
  'web.photo.angle.intRearSeatsPassenger.hint':
    'Porta traseira do passageiro aberta: banco, assoalho e forro.',
  'web.photo.angle.intRearSeatsPassenger.label': 'Atrás, lado do passageiro',
  'web.photo.angle.intTrunk.hint': 'Porta-malas aberto e vazio, com o assoalho à vista.',
  'web.photo.angle.intTrunk.label': 'Porta-malas',
  'web.photo.check.blurry': 'A foto ficou tremida. Firme bem o celular e tire de novo.',
  'web.photo.check.galleryForbidden': 'Na entrega, tire a foto agora com a câmera do app.',
  'web.photo.check.personVisible': 'Tem alguém na foto. Tire de novo sem ninguém no enquadramento.',
  'web.photo.check.plateVisible': 'Dá para ler a placa. Vamos desfocá-la antes de publicar a foto.',
  'web.photo.check.portrait': 'Vire o celular na horizontal para esta foto.',
  'web.photo.check.tooDark': 'A foto ficou escura demais. Procure mais luz e tire de novo.',
  'web.photo.check.tooSmall': 'A foto é pequena demais. Use a câmera principal do celular.',
  'web.photo.handover.both':
    'Anfitrião e viajante fazem cada um a sua série. Uma não substitui a outra.',
  'web.photo.handover.camera': 'Use a câmera do app. Fotos da galeria não são aceitas.',
  'web.photo.handover.count':
    'Tire {exterior} fotos por fora, {interior} por dentro, além do combustível e do hodômetro.',
  'web.photo.handover.plate':
    'Aqui a placa pode aparecer: estas fotos são prova e nunca são publicadas.',
  'web.photo.handover.title': 'Fotos da entrega',
  'web.photo.listing.count':
    'Envie pelo menos {min} fotos. Com {recommended}, o viajante vê o carro inteiro.',
  'web.photo.listing.cover': 'Esta é a foto de capa: a primeira que os viajantes veem.',
  'web.photo.listing.title': 'Fotos do seu carro',
  'web.photo.rule.forbidden.aiGenerated':
    'Imagens criadas ou alteradas por inteligência artificial são recusadas.',
  'web.photo.rule.forbidden.contact':
    'Sem telefone, QR code ou link: tudo passa pelas mensagens da {brand}.',
  'web.photo.rule.forbidden.documents': 'Não fotografe documentos nem telas com dados pessoais.',
  'web.photo.rule.forbidden.offensive':
    'Nada indecente, violento ou ofensivo a uma pessoa ou a um grupo.',
  'web.photo.rule.forbidden.overlay': 'Nada de texto, logotipo, moldura ou marca d’água na foto.',
  'web.photo.rule.forbidden.people': 'Nenhuma pessoa na foto, nem mesmo em um reflexo.',
  'web.photo.rule.forbidden.plate':
    'Se a placa estiver legível, nós a desfocamos antes de publicar a foto.',
  'web.photo.rule.forbidden.stock':
    'Só fotos do seu próprio carro, nunca da internet ou de um catálogo.',
  'web.photo.rule.forbidden.unsafe':
    'O carro não pode aparecer em guincho, batido ou em lugar perigoso.',
  'web.photo.rule.framing.background': 'Escolha um fundo limpo, sem outros carros nem pessoas.',
  'web.photo.rule.framing.clean': 'Lave o carro e tire seus objetos pessoais antes das fotos.',
  'web.photo.rule.framing.fill': 'O carro ocupa quase toda a largura da foto, sem ficar cortado.',
  'web.photo.rule.framing.height': 'Nas fotos externas, deixe o celular na altura dos faróis.',
  'web.photo.rule.framing.level': 'Segure o celular na horizontal, com o horizonte reto.',
  'web.photo.rule.framing.safeArea':
    'Deixe uma folga em volta do carro: a capa perde um pouco em cima e embaixo.',
  'web.photo.rule.light.backlight': 'Fique de costas para o sol, nunca com o sol atrás do carro.',
  'web.photo.rule.light.daylight':
    'Fotografe de dia, com luz suave: manhã, fim de tarde ou céu nublado.',
  'web.photo.rule.light.night':
    'À noite, só na entrega: acenda uma luz e chegue perto de cada dano.',
  'web.photo.rule.light.noFilter': 'Sem filtro nem edição: a foto mostra o carro como ele está.',
  'web.photo.rule.light.reflections':
    'Mude de lugar se o seu reflexo aparecer na lataria ou nos vidros.',
  'web.photo.slot.damage': 'Dano {number}',
  'web.photo.slot.key': 'Chave',
} as const satisfies Readonly<Record<MessageKey, Message>>;
