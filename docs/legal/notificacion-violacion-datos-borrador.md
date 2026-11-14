# Gabarits de notification d'une violation de données et d'interruption de service — BROUILLON

> **BROUILLON, NON VALIDÉ.** Gabarits à faire valider par l'avocat au Panama (Ley 81 de 2019 et son règlement ; autorité : ANTAI, à confirmer) et au Paraguay (autorité et texte applicables à confirmer), OQ-MK-09. Aucun ne doit être envoyé tel quel avant cette validation (GO_LIVE_CHECKLIST GL-16). US-112, ADR-121. Procédure : [`docs/ops/INCIDENT_RESPONSE.md`](../ops/INCIDENT_RESPONSE.md).
>
> Les champs entre crochets se remplissent à partir du registre (`core.audit_security_incident`) et du post-mortem. Ne jamais y mettre plus de données personnelles que nécessaire. La marque (`[MARQUE]`) est une donnée de thème (DEC-MARQUE).

## A. Notification à l'autorité de contrôle (espagnol)

**Asunto** : Notificación de vulneración de seguridad de datos personales — [MARQUE] — referencia [ID DEL INCIDENTE]

Señores [AUTORIDAD]:

En cumplimiento de [NORMA APLICABLE, A CONFIRMAR POR EL ABOGADO], [RAZÓN SOCIAL DEL RESPONSABLE], responsable del tratamiento de la plataforma [MARQUE], notifica la siguiente vulneración de seguridad:

1. **Fecha y hora de detección** (UTC): [DETECTED_AT]. Fecha estimada de inicio: [SI SE CONOCE].
2. **Naturaleza** : [descripción breve: acceso no autorizado, divulgación, pérdida, alteración].
3. **Categorías de datos afectados** : [p. ej. datos de contacto, documento de identidad, datos biométricos].
4. **Número aproximado de personas afectadas** : [SUBJECTS_COUNT_ESTIMATE] ; países: [PAÍS].
5. **Consecuencias probables** : [descripción].
6. **Medidas adoptadas y propuestas** : contención el [CONTAINED_AT] ; [medidas].
7. **Comunicación a las personas afectadas** : [enviada el … / prevista el … / motivo para no hacerlo].
8. **Contacto** : [RESPONSABLE O CONTACTO DE DATOS], [correo de contacto de datos].

Si esta notificación es incompleta, se completará en cuanto se disponga de la información (**notificación complementaria** n.º [N], con la misma referencia).

[Lugar, fecha, firma]

## B. Comunicación a las personas afectadas

Texto corto, claro, sin jerga. Se envía en la lengua de la cuenta de la persona.

### es

**Asunto** : Aviso importante sobre la seguridad de tus datos en [MARQUE]

Hola:

El [FECHA] detectamos un incidente de seguridad que afecta a algunos de tus datos: [CATEGORÍAS]. [QUÉ PASÓ, EN UNA FRASE]. Ya [MEDIDAS TOMADAS]. Te recomendamos [ACCIONES PARA LA PERSONA, p. ej. cambiar tu contraseña, desconfiar de mensajes que pidan datos]. Nunca te pediremos tu contraseña ni un código por mensaje.

Si tienes preguntas, escríbenos a [CONTACTO DE DATOS]. Puedes ejercer tus derechos sobre tus datos personales en cualquier momento.

El equipo de [MARQUE]

### en

**Subject** : Important notice about the security of your data at [MARQUE]

Hello,

On [DATE] we detected a security incident affecting some of your data: [CATEGORIES]. [WHAT HAPPENED, IN ONE SENTENCE]. We have already [MEASURES TAKEN]. We recommend that you [ACTIONS FOR THE PERSON, e.g. change your password, be wary of messages asking for your details]. We will never ask for your password or a code by message.

If you have questions, write to us at [DATA CONTACT]. You can exercise your rights over your personal data at any time.

The [MARQUE] team

### fr

**Objet** : Avis important sur la sécurité de vos données chez [MARQUE]

Bonjour,

Le [DATE], nous avons détecté un incident de sécurité qui touche certaines de vos données : [CATÉGORIES]. [CE QUI S'EST PASSÉ, EN UNE PHRASE]. Nous avons déjà [MESURES PRISES]. Nous vous conseillons de [GESTES POUR LA PERSONNE, par exemple changer votre mot de passe, vous méfier des messages qui demandent vos informations]. Nous ne vous demanderons jamais votre mot de passe ni un code par message.

Pour toute question, écrivez-nous à [CONTACT DONNÉES]. Vous pouvez exercer vos droits sur vos données personnelles à tout moment.

L'équipe [MARQUE]

### pt-BR

**Assunto** : Aviso importante sobre a segurança dos seus dados na [MARQUE]

Olá,

Em [DATA], detectamos um incidente de segurança que afeta alguns dos seus dados: [CATEGORIAS]. [O QUE ACONTECEU, EM UMA FRASE]. Já [MEDIDAS TOMADAS]. Recomendamos que você [AÇÕES PARA A PESSOA, por exemplo trocar a sua senha, desconfiar de mensagens que peçam seus dados]. Nunca pediremos a sua senha nem um código por mensagem.

Se tiver dúvidas, escreva para [CONTATO DE DADOS]. Você pode exercer os seus direitos sobre os seus dados pessoais a qualquer momento.

A equipe [MARQUE]

## C. Interruption de service (voyageurs et hôtes)

Aucune obligation légale propre : information des utilisateurs pendant une reprise (DISASTER_RECOVERY.md § 5). Aucune donnée personnelle.

### es

[MARQUE] no está disponible en este momento por un problema técnico. Estamos trabajando para restablecer el servicio. Si tienes un viaje en curso, la entrega y la devolución del vehículo siguen como se acordó con la otra persona. Te avisaremos cuando el servicio vuelva.

### en

[MARQUE] is currently unavailable because of a technical problem. We are working to restore the service. If you have a trip in progress, the vehicle handover and return go ahead as agreed with the other person. We will let you know when the service is back.

### fr

[MARQUE] est indisponible pour le moment à cause d'un problème technique. Nous travaillons à rétablir le service. Si vous avez un trajet en cours, la remise et le retour du véhicule se font comme convenu avec l'autre personne. Nous vous préviendrons dès le retour du service.

### pt-BR

A [MARQUE] está indisponível no momento por causa de um problema técnico. Estamos trabalhando para restabelecer o serviço. Se você tem uma viagem em andamento, a entrega e a devolução do veículo seguem como combinado com a outra pessoa. Avisaremos quando o serviço voltar.
