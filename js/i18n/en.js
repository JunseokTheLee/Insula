// English runtime strings — only text that JS still generates at runtime
// (toasts, confirm dialogs, template messages). Static page text lives
// directly in each /en/*.html file instead of a data-i18n attribute.
window.CURRENT_LANG = 'en';

const T = {
  guest: 'Guest', signIn: 'Sign in', myProfile: 'My Profile',
  loading: 'Loading…', anonymous: 'Anonymous', optionalHint: '(optional)',
  moreLabel: 'more', deleteLabel: 'Delete', replyLabel: 'Reply',
  writeAReplyPlaceholder: 'Write a reply…',
  areYouSure: 'Are you sure?', continueLabel: 'Continue',
  imageUploadFailed: 'Image upload failed: {msg}', imageTooLarge: 'Image too large — max 8 MB',
  couldNotUpdateLike: 'Could not update like', couldNotUpdateCollection: 'Could not update exhibition',
  couldNotUpdateSaveUser: 'Could not update save', saveLabel: 'Save', savingLabel: 'Saving',
  savesCountLabel: '{n} Saves', savedByCountLabel: '{n} Saved by',
  savesListTitle: 'Saves', savedByListTitle: 'Saved by', noOneYet: 'No one yet.',
  deleteArtworkTitle: 'Delete artwork?',
  deleteArtworkMessage: "Delete this artwork? This can't be undone, and its cell will open up for a new submission.",
  couldNotDeleteArtwork: 'Could not delete artwork', artworkDeleted: 'Artwork deleted',
  noCommentsYet: 'No comments yet.',
  couldNotPostComment: 'Could not post comment', couldNotDeleteComment: 'Could not delete comment',
  archivedBadge: 'Archived',
  viewingNetwork: "viewing {name}'s network",
  userNotFound: 'User not found',
  completeYourProfile: 'Complete Your Profile', welcomeToWeavo: 'Welcome to Weavo', editProfile: 'Edit Profile',
  requiredNoteCountryOnly: 'Select your country to finish setting up your account.',
  requiredNoteFull: 'Set a username and select your country to finish creating your account.',
  usernameRequired: 'Username is required to continue.', pleaseSelectCountry: 'Please select your country.',
  invalidLinkUrl: "That {label} link doesn't look like a valid URL.",
  usernameTaken: 'That username is taken.', couldNotSaveTryAgain: 'Could not save. Try again.',
  welcomeToast: 'Welcome!', profileSavedToast: 'Profile saved',
  deleteAccountTitle: 'Delete your account?', deleteAccountConfirmLabel: 'Delete my account',
  deleteAccountMessage: "This permanently deletes your account, profile, artwork, comments, exhibitions, and saves. This can't be undone. Type your username, {username}, below to confirm.",
  couldNotDeleteAccount: 'Could not delete account. Try again.', accountDeleted: 'Your account has been deleted.',
  couldNotLoadProjects: 'Could not load projects',
  couldNotLoadArtists: 'Could not load artists',
  couldNotLoadArtworks: 'Could not load artworks',
  untitledArtwork: 'Untitled artwork',
  goToProject: 'Go to project {n}',
  projectNotFound: 'Project not found',
  archivedIterationLabel: 'This is an archived iteration (v{version}) — frozen the way it looked before a reshape.',
  enlargePreview: 'Enlarge reference preview', shrinkPreview: 'Shrink reference preview',
  couldNotLoadWeavo: 'Could not load weavo',
  titleRequired: 'Title is required.', addReferenceImage: 'Add a reference image.',
  widthHeightRange: 'Width and height must be 1-100, and no more than 10,000 cells total.',
  creatingProject: 'Creating project…',
  imageFullyTransparent: 'This image is fully transparent — nothing to build a weavo from.',
  couldNotCreateProjectMsg: 'Could not create project: {msg}',
  couldNotCreateProjectRetry: 'Could not create project — try again',
  couldNotReshapeProjectRetry: 'Could not reshape project — try again.',
  reshapeConfirmMessage: '{count} already-submitted piece{plural} will be redistributed onto the new grid based on closest color match. This can\'t be undone. Continue?',
  reshapeConfirmMessageWithDrop: '{count} already-submitted pieces will be redistributed onto the new, smaller grid — {dropped} of them won\'t fit and will be returned to their artists\' profiles instead. This can\'t be undone. Continue?',
  reshapeConfirmTitle: 'Reshape this weavo?', reshapeConfirmOk: 'Reshape',
  reshapingProject: 'Reshaping grid and redistributing artwork…',
  couldNotReshapeProjectMsg: 'Could not reshape project: {msg}',
  projectReshaped: 'Grid reshaped — artwork redistributed!',
  projectReshapedWithDrop: 'Grid reshaped — {dropped} piece(s) returned to their artists\' profiles.',
  addImageFirst: 'Add an image first.', linkMustBeValidUrl: 'That link needs to be a valid http(s) URL.',
  findingBestSpot: 'Finding the best spot…', couldNotSubmitRetry: 'Could not submit — try again',
  uploadRateLimited: 'Too many uploads in a short time — please wait a few minutes and try again.',
  uploadingToast: 'Uploading…',
  artworkMatchedToast: 'Your artwork found a match and is part of a project!',
  artworkPooledToast: 'Added to your profile — waiting for a good match.',
  waitingForMatchBadge: 'Waiting for a match',
  removeFromProjectTitle: 'Remove from project?',
  removeFromProjectLabel: 'Remove',
  removeFromProjectMessage: "Remove this piece from its project? It won't be deleted — it goes back to the artist's profile and can be matched into a project again later.",
  couldNotRemoveArtwork: 'Could not remove artwork — try again',
  artworkRemovedFromProject: 'Artwork removed from project — back in the artist\'s pool.',
  projectCreated: 'Project created!',
  artistAvatarAlt: '{name}’s profile picture',
  artworkThumbAlt: '“{title}” by {name}',
  artworkImgAltFallback: 'Artwork by {name}',
  artworkNotFound: 'Artwork not found',
  projectPreviewAlt: 'Reference image for the “{title}” project',
  projectsCrumb: 'Projects',
  collectionsCrumb: 'Exhibitions',
  newCollectionLabel: 'New Exhibition',
  couldNotCreateCollectionMsg: 'Could not create exhibition: {msg}',
  couldNotCreateCollectionRetry: 'Could not create exhibition — try again',
  collectionCreatedToast: 'Exhibition created!',
  couldNotLoadCollections: 'Could not load exhibitions',
  collectionNotFound: 'Exhibition not found',
  noCollectionsYet: 'No exhibitions yet.',
  addToCollectionLabel: 'Add to exhibition',
  removeFromCollection: 'Remove from exhibition',
  privateBadge: 'Private',
  deleteCollectionTitle: 'Delete this exhibition?',
  deleteCollectionMessage: "This deletes the exhibition itself, not the artwork in it — pieces stay saved and simply lose this grouping. Can't be undone.",
  couldNotDeleteCollection: 'Could not delete exhibition — try again',
  collectionDeletedToast: 'Exhibition deleted',
  collectionCoverAlt: 'Cover image for the “{title}” exhibition',
  collectionMetaDescFallback: 'A mini-exhibition curated by {name} on Weavo.',
  doneLabel: 'Done',
  publishBtn: 'Publish', unpublishBtn: 'Unpublish',
  statusPublished: 'Published', statusUnpublished: 'Unpublished',
  statusPublishedEndsOn: 'Published · ends {date}',
  statusUnpublishedEnded: 'Unpublished — ended {date}',
  endDateLabel: 'End date',
  publishedToast: 'Exhibition published', unpublishedToast: 'Exhibition unpublished',
  couldNotPublishCollection: 'Could not update — try again',
  addToExhibitionBtn: 'Add to Exhibition',
  newExhibitionTitlePlaceholder: 'New exhibition title…',
  createLabel: 'Create',
};

function tr(key, vars) {
  let s = T[key] ?? key;
  if (vars) for (const k in vars) s = s.split(`{${k}}`).join(vars[k]);
  return s;
}

// Display labels for DISABILITY_KEYS (see js/common.js).
const DISABILITY_LABELS = {
  physical_mobility: 'Physical / mobility disability',
  blind_low_vision: 'Blind / low vision',
  deaf_hard_of_hearing: 'Deaf / hard of hearing',
  neurodivergent: 'Neurodivergent (ADHD, autism, dyslexia, etc.)',
  chronic_illness: 'Chronic illness / chronic pain',
  mental_health: 'Mental health condition',
  speech_communication: 'Speech / communication disability',
  other: 'Other disability',
  prefer_not_to_say: 'Prefer not to say',
};
function disabilityLabel(key) { return DISABILITY_LABELS[key] || key; }
function fmtJoined(dateStr) {
  const d = new Date(dateStr);
  return `Joined ${d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
}
function fmtShortDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
// art_completed_date is a plain date (YYYY-MM-DD, no time/zone) — built from
// its y/m/d parts directly rather than `new Date(dateStr)`, which parses a
// bare date string as UTC midnight and can print a day early in any
// negative-UTC-offset timezone.
function fmtCompletedDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
function pieceContributedText(n) {
  return `${n} piece${n !== 1 ? 's' : ''} contributed`;
}
function filledText(filled, total) {
  return `${filled} / ${total} filled`;
}
function openCellTooltip(c) {
  return `rgb(${c.r}, ${c.g}, ${c.b}) — ${c.count} open cell${c.count !== 1 ? 's' : ''}`;
}
function moreCellsTooltip(remainder) {
  return `${remainder} more open cell${remainder !== 1 ? 's' : ''} in other shades`;
}
function projectCreatedToast(skipped) {
  if (!skipped) return tr('projectCreated');
  return `Project created! (${skipped} transparent cell${skipped !== 1 ? 's' : ''} excluded)`;
}
function collectionItemCountText(n) {
  return `${n} piece${n !== 1 ? 's' : ''}`;
}

// ISO 3166-1 numeric → country name, same ids main.html's world map uses
// for country_id, so a profile's country stays consistent with any
// map/flag lookups elsewhere in the app.
const COUNTRY_NAMES = {
  4:"Afghanistan",8:"Albania",12:"Algeria",24:"Angola",32:"Argentina",
  36:"Australia",40:"Austria",50:"Bangladesh",56:"Belgium",64:"Bhutan",
  68:"Bolivia",76:"Brazil",100:"Bulgaria",104:"Myanmar",116:"Cambodia",
  120:"Cameroon",124:"Canada",140:"Central African Republic",144:"Sri Lanka",
  152:"Chile",156:"China",170:"Colombia",178:"Congo",180:"DR Congo",
  188:"Costa Rica",191:"Croatia",192:"Cuba",196:"Cyprus",203:"Czechia",
  208:"Denmark",218:"Ecuador",818:"Egypt",222:"El Salvador",231:"Ethiopia",
  246:"Finland",250:"France",266:"Gabon",276:"Germany",288:"Ghana",
  300:"Greece",320:"Guatemala",324:"Guinea",332:"Haiti",340:"Honduras",
  348:"Hungary",352:"Iceland",356:"India",360:"Indonesia",364:"Iran",
  368:"Iraq",372:"Ireland",376:"Israel",380:"Italy",388:"Jamaica",
  392:"Japan",400:"Jordan",398:"Kazakhstan",404:"Kenya",410:"South Korea",
  408:"North Korea",414:"Kuwait",418:"Laos",422:"Lebanon",430:"Liberia",
  434:"Libya",440:"Lithuania",442:"Luxembourg",450:"Madagascar",
  454:"Malawi",458:"Malaysia",462:"Maldives",466:"Mali",484:"Mexico",
  496:"Mongolia",504:"Morocco",508:"Mozambique",516:"Namibia",524:"Nepal",
  528:"Netherlands",554:"New Zealand",558:"Nicaragua",566:"Nigeria",
  578:"Norway",512:"Oman",586:"Pakistan",591:"Panama",598:"Papua New Guinea",
  600:"Paraguay",604:"Peru",608:"Philippines",616:"Poland",620:"Portugal",
  634:"Qatar",642:"Romania",643:"Russia",646:"Rwanda",682:"Saudi Arabia",
  686:"Senegal",694:"Sierra Leone",703:"Slovakia",705:"Slovenia",
  706:"Somalia",710:"South Africa",728:"South Sudan",724:"Spain",
  729:"Sudan",752:"Sweden",756:"Switzerland",760:"Syria",158:"Taiwan",
  762:"Tajikistan",764:"Thailand",768:"Togo",788:"Tunisia",792:"Turkey",
  800:"Uganda",804:"Ukraine",784:"United Arab Emirates",826:"United Kingdom",
  840:"United States",858:"Uruguay",860:"Uzbekistan",862:"Venezuela",
  704:"Vietnam",887:"Yemen",894:"Zambia",716:"Zimbabwe",44:"Bahamas",
  48:"Bahrain",84:"Belize",204:"Benin",72:"Botswana",96:"Brunei",
  854:"Burkina Faso",108:"Burundi",132:"Cape Verde",214:"Dominican Republic",
  384:"Ivory Coast",242:"Fiji",270:"Gambia",478:"Mauritania",480:"Mauritius",
  562:"Niger",31:"Azerbaijan",51:"Armenia",90:"Solomon Islands",
  112:"Belarus",174:"Comoros",226:"Equatorial Guinea",232:"Eritrea",
  262:"Djibouti",268:"Georgia",275:"Palestine",328:"Guyana",
  417:"Kyrgyzstan",426:"Lesotho",498:"Moldova",
  499:"Montenegro",534:"Sint Maarten",540:"New Caledonia",548:"Vanuatu",
  626:"Timor-Leste",674:"San Marino",688:"Serbia",
  732:"Western Sahara",740:"Suriname",780:"Trinidad and Tobago",
  795:"Turkmenistan",807:"North Macedonia"
};
function countryName(id) { return COUNTRY_NAMES[id] || ''; }
