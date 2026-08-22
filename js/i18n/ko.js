// Korean runtime strings — only text that JS still generates at runtime
// (toasts, confirm dialogs, template messages). Static page text lives
// directly in each /ko/*.html file instead of a data-i18n attribute.
window.CURRENT_LANG = 'ko';

const T = {
  guest: '게스트', signIn: '로그인', myProfile: '내 프로필',
  loading: '불러오는 중…', anonymous: '익명', optionalHint: '(선택)',
  moreLabel: '더보기', deleteLabel: '삭제', replyLabel: '답글',
  writeAReplyPlaceholder: '답글을 입력하세요…',
  areYouSure: '확실한가요?', continueLabel: '계속',
  imageUploadFailed: '이미지 업로드에 실패했습니다: {msg}', imageTooLarge: '이미지가 너무 큽니다 — 최대 8MB',
  couldNotUpdateLike: '좋아요를 업데이트할 수 없습니다', couldNotUpdateCollection: '전시를 업데이트할 수 없습니다',
  couldNotUpdateSaveUser: '저장을 업데이트할 수 없습니다', saveLabel: '저장', savingLabel: '저장 중',
  savesCountLabel: '저장 {n}', savedByCountLabel: '저장됨 {n}',
  savesListTitle: '저장', savedByListTitle: '저장한 사람', noOneYet: '아직 아무도 없습니다.',
  deleteArtworkTitle: '작품을 삭제할까요?',
  deleteArtworkMessage: '이 작품을 삭제할까요? 되돌릴 수 없으며, 해당 칸은 새로운 제출을 위해 다시 열립니다.',
  couldNotDeleteArtwork: '작품을 삭제할 수 없습니다', artworkDeleted: '작품이 삭제되었습니다',
  noCommentsYet: '아직 댓글이 없습니다.',
  couldNotPostComment: '댓글을 게시할 수 없습니다', couldNotDeleteComment: '댓글을 삭제할 수 없습니다',
  archivedBadge: '보관됨',
  viewingNetwork: '{name}님의 네트워크 보는 중',
  userNotFound: '사용자를 찾을 수 없습니다',
  completeYourProfile: '프로필을 완성하세요', welcomeToWeavo: 'Weavo에 오신 것을 환영합니다', editProfile: '프로필 수정',
  requiredNoteCountryOnly: '계정 설정을 완료하려면 국가를 선택하세요.',
  requiredNoteFull: '계정을 완성하려면 사용자 이름을 설정하고 국가를 선택하세요.',
  usernameRequired: '계속하려면 사용자 이름이 필요합니다.', pleaseSelectCountry: '국가를 선택해주세요.',
  invalidLinkUrl: '{label} 링크가 올바른 URL 형식이 아닙니다.',
  usernameTaken: '이미 사용 중인 사용자 이름입니다.', couldNotSaveTryAgain: '저장할 수 없습니다. 다시 시도해주세요.',
  welcomeToast: '환영합니다!', profileSavedToast: '프로필이 저장되었습니다',
  deleteAccountTitle: '계정을 삭제할까요?', deleteAccountConfirmLabel: '계정 삭제하기',
  deleteAccountMessage: '계정, 프로필, 작품, 댓글, 전시, 저장 정보가 모두 영구적으로 삭제됩니다. 되돌릴 수 없습니다. 확인하려면 아래에 사용자 이름 {username}을(를) 입력하세요.',
  couldNotDeleteAccount: '계정을 삭제할 수 없습니다. 다시 시도해주세요.', accountDeleted: '계정이 삭제되었습니다.',
  couldNotLoadProjects: '프로젝트를 불러올 수 없습니다',
  couldNotLoadArtists: '작가 목록을 불러올 수 없습니다',
  couldNotLoadArtworks: '작품을 불러올 수 없습니다',
  untitledArtwork: '제목 없는 작품',
  goToProject: '{n}번째 프로젝트로 이동',
  projectNotFound: '프로젝트를 찾을 수 없습니다',
  archivedIterationLabel: '이전 버전(v{version})입니다 — 재구성 전 모습 그대로 보존되었습니다.',
  enlargePreview: '미리보기 확대', shrinkPreview: '미리보기 축소',
  couldNotLoadWeavo: 'Weavo를 불러올 수 없습니다',
  titleRequired: '제목을 입력해주세요.', addReferenceImage: '참조 이미지를 추가해주세요.',
  widthHeightRange: '너비와 높이는 1~100 사이여야 하며, 전체 칸 수는 10,000칸을 넘을 수 없습니다.',
  creatingProject: '프로젝트를 만드는 중…',
  imageFullyTransparent: '이 이미지는 완전히 투명하여 Weavo를 만들 수 없습니다.',
  couldNotCreateProjectMsg: '프로젝트를 생성할 수 없습니다: {msg}',
  couldNotCreateProjectRetry: '프로젝트를 생성할 수 없습니다 — 다시 시도해주세요',
  couldNotReshapeProjectRetry: '프로젝트를 재구성할 수 없습니다 — 다시 시도해주세요.',
  reshapeConfirmMessage: '이미 제출된 작품 {count}개가 색상이 가장 가까운 칸으로 새 그리드에 재배치됩니다. 되돌릴 수 없습니다. 계속할까요?',
  reshapeConfirmMessageWithDrop: '이미 제출된 작품 {count}개가 새로운(더 작은) 그리드에 재배치됩니다 — 이 중 {dropped}개는 자리가 없어 작가의 프로필로 돌아갑니다. 되돌릴 수 없습니다. 계속할까요?',
  reshapeConfirmTitle: '이 Weavo를 재구성할까요?', reshapeConfirmOk: '재구성',
  reshapingProject: '그리드를 재구성하고 작품을 재배치하는 중…',
  couldNotReshapeProjectMsg: '프로젝트를 재구성할 수 없습니다: {msg}',
  projectReshaped: '그리드가 재구성되었습니다 — 작품이 재배치되었습니다!',
  projectReshapedWithDrop: '그리드가 재구성되었습니다 — {dropped}개의 작품이 작가의 프로필로 돌아갔습니다.',
  addImageFirst: '먼저 이미지를 추가해주세요.', linkMustBeValidUrl: '링크는 올바른 http(s) URL이어야 합니다.',
  findingBestSpot: '가장 알맞은 자리를 찾는 중…', couldNotSubmitRetry: '제출할 수 없습니다 — 다시 시도해주세요',
  uploadRateLimited: '짧은 시간 동안 너무 많이 업로드했습니다 — 잠시 후 다시 시도해주세요.',
  uploadingToast: '업로드 중…',
  artworkMatchedToast: '작품이 매칭되어 프로젝트에 포함되었습니다!',
  artworkPooledToast: '프로필에 추가되었습니다 — 잘 맞는 프로젝트를 기다리는 중이에요.',
  waitingForMatchBadge: '매칭 대기 중',
  removeFromProjectTitle: '프로젝트에서 제외할까요?',
  removeFromProjectLabel: '제외',
  removeFromProjectMessage: '이 작품을 프로젝트에서 제외할까요? 삭제되지는 않으며, 작가의 프로필로 돌아가 나중에 다시 매칭될 수 있습니다.',
  couldNotRemoveArtwork: '작품을 제외할 수 없습니다 — 다시 시도해주세요',
  artworkRemovedFromProject: '작품이 프로젝트에서 제외되어 작가의 프로필로 돌아갔습니다.',
  projectCreated: '프로젝트가 생성되었습니다!',
  artistAvatarAlt: '{name}님의 프로필 사진',
  artworkThumbAlt: '{name}의 작품 ‘{title}’',
  artworkImgAltFallback: '{name}님의 작품',
  artworkNotFound: '작품을 찾을 수 없습니다',
  projectPreviewAlt: '‘{title}’ 프로젝트의 참조 이미지',
  projectsCrumb: '프로젝트',
  collectionsCrumb: '전시',
  newCollectionLabel: '새 전시',
  couldNotCreateCollectionMsg: '전시를 만들 수 없습니다: {msg}',
  couldNotCreateCollectionRetry: '전시를 만들 수 없습니다 — 다시 시도해주세요',
  collectionCreatedToast: '전시가 생성되었습니다!',
  couldNotLoadCollections: '전시를 불러올 수 없습니다',
  collectionNotFound: '전시를 찾을 수 없습니다',
  noCollectionsYet: '아직 전시가 없습니다.',
  addToCollectionLabel: '전시에 추가',
  removeFromCollection: '전시에서 제거',
  privateBadge: '비공개',
  deleteCollectionTitle: '이 전시를 삭제할까요?',
  deleteCollectionMessage: '전시 자체만 삭제되며, 안에 있던 작품은 삭제되지 않고 계속 저장된 상태로 남습니다. 되돌릴 수 없습니다.',
  couldNotDeleteCollection: '전시를 삭제할 수 없습니다 — 다시 시도해주세요',
  collectionDeletedToast: '전시가 삭제되었습니다',
  collectionCoverAlt: '‘{title}’ 전시의 커버 이미지',
  collectionMetaDescFallback: '{name}님이 Weavo에서 큐레이션한 미니 전시입니다.',
  doneLabel: '완료',
  publishBtn: '게시하기', unpublishBtn: '게시 취소',
  statusPublished: '게시됨', statusUnpublished: '미게시',
  statusPublishedEndsOn: '게시됨 · {date}까지',
  statusUnpublishedEnded: '미게시 — {date}에 종료됨',
  endDateLabel: '종료일',
  publishedToast: '전시가 게시되었습니다', unpublishedToast: '전시가 게시 취소되었습니다',
  couldNotPublishCollection: '업데이트할 수 없습니다 — 다시 시도해주세요',
  addToExhibitionBtn: '전시에 추가',
  newExhibitionTitlePlaceholder: '새 전시 제목…',
  createLabel: '만들기',
  selectDisabilitiesPlaceholder: '장애 유형 선택…',
  cancelLabel: '취소',
  reportBtnLabel: '신고',
  reportAriaLabel_submission: '이 작품 신고',
  reportAriaLabel_comment: '이 댓글 신고',
  reportAriaLabel_profile: '이 계정 신고',
  reportTitle_submission: '작품 신고',
  reportTitle_comment: '댓글 신고',
  reportTitle_profile: '계정 신고',
  reportReasonLabel: '사유',
  reportReason_spam: '스팸',
  reportReason_harassment: '괴롭힘',
  reportReason_hate_speech: '혐오 발언',
  reportReason_nudity: '노출 또는 선정적 콘텐츠',
  reportReason_misinformation: '허위 정보',
  reportReason_other: '기타',
  reportDetailsLabel: '추가 설명',
  reportDetailsPlaceholder: '검토자가 알아야 할 내용이 있나요?',
  reportSubmitLabel: '신고 제출',
  reportSubmittedToast: '신고가 접수되었습니다. 감사합니다.',
  alreadyReportedToast: '이미 신고하셨습니다.',
  couldNotSubmitReport: '신고를 제출할 수 없습니다. 다시 시도해주세요.',
};

function tr(key, vars) {
  let s = T[key] ?? key;
  if (vars) for (const k in vars) s = s.split(`{${k}}`).join(vars[k]);
  return s;
}

// Display labels for DISABILITY_GROUPS/DISABILITY_KEYS (see js/common.js).
const DISABILITY_GROUP_LABELS = {
  physical: '신체 및 이동',
  vision: '시각',
  hearing: '청각',
  neurodivergent_learning: '신경다양성 및 학습',
  mental_health: '정신 건강',
  chronic_health: '만성 건강 질환',
  speech_communication: '언어 및 의사소통',
  other: '기타',
};
const DISABILITY_LABELS = {
  no_disability: '장애 없음',
  mobility: '지체 장애 (예: 휠체어 또는 보행 보조기구 사용)',
  dexterity: '손 조작 / 소근육 장애',
  limb_difference: '사지 결손 또는 차이',
  blind: '전맹',
  low_vision: '저시력',
  color_blindness: '색각 이상 (색맹/색약)',
  deaf: '농 (청각 상실)',
  hard_of_hearing: '난청',
  adhd: 'ADHD (주의력결핍 과잉행동장애)',
  autism: '자폐 스펙트럼',
  learning_disability: '난독증 등 학습 장애',
  tourettes_tic: '투렛 증후군 또는 틱 장애',
  intellectual_developmental: '지적 장애 또는 발달 장애',
  anxiety: '불안 장애',
  depression: '우울증',
  mental_health_other: '기타 정신 건강 관련 어려움',
  chronic_illness: '만성 질환',
  chronic_pain: '만성 통증',
  fatigue_condition: '만성 피로 (예: 근육통성 뇌척수염, 롱코비드)',
  speech: '언어 장애',
  nonverbal_communication: '비언어적 의사소통 / 보완대체의사소통(AAC) 사용',
  other: '기타 장애',
  prefer_not_to_say: '밝히고 싶지 않음',
};
function disabilityLabel(key) { return DISABILITY_LABELS[key] || key; }
function disabilityGroupLabel(key) { return DISABILITY_GROUP_LABELS[key] || key; }
function fmtJoined(dateStr) {
  const d = new Date(dateStr);
  return `${d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' })} 가입`;
}
function fmtShortDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}
// art_completed_date is a plain date (YYYY-MM-DD, no time/zone) — built from
// its y/m/d parts directly rather than `new Date(dateStr)`, which parses a
// bare date string as UTC midnight and can print a day early in any
// negative-UTC-offset timezone.
function fmtCompletedDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}
function pieceContributedText(n) {
  return `${n}점 참여`;
}
function filledText(filled, total) {
  return `${filled} / ${total} 완성`;
}
function openCellTooltip(c) {
  return `rgb(${c.r}, ${c.g}, ${c.b}) — 빈 칸 ${c.count}개`;
}
function moreCellsTooltip(remainder) {
  return `다른 색조의 빈 칸 ${remainder}개 더`;
}
function projectCreatedToast(skipped) {
  if (!skipped) return tr('projectCreated');
  return `프로젝트가 생성되었습니다! (투명한 칸 ${skipped}개 제외됨)`;
}
function collectionItemCountText(n) {
  return `${n}점`;
}

// ISO 3166-1 numeric → country name, same ids main.html's world map uses
// for country_id, so a profile's country stays consistent with any
// map/flag lookups elsewhere in the app.
const COUNTRY_NAMES = {
  4:"아프가니스탄",8:"알바니아",12:"알제리",24:"앙골라",32:"아르헨티나",
  36:"호주",40:"오스트리아",50:"방글라데시",56:"벨기에",64:"부탄",
  68:"볼리비아",76:"브라질",100:"불가리아",104:"미얀마",116:"캄보디아",
  120:"카메룬",124:"캐나다",140:"중앙아프리카공화국",144:"스리랑카",
  152:"칠레",156:"중국",170:"콜롬비아",178:"콩고",180:"콩고민주공화국",
  188:"코스타리카",191:"크로아티아",192:"쿠바",196:"키프로스",203:"체코",
  208:"덴마크",218:"에콰도르",818:"이집트",222:"엘살바도르",231:"에티오피아",
  246:"핀란드",250:"프랑스",266:"가봉",276:"독일",288:"가나",
  300:"그리스",320:"과테말라",324:"기니",332:"아이티",340:"온두라스",
  348:"헝가리",352:"아이슬란드",356:"인도",360:"인도네시아",364:"이란",
  368:"이라크",372:"아일랜드",376:"이스라엘",380:"이탈리아",388:"자메이카",
  392:"일본",400:"요르단",398:"카자흐스탄",404:"케냐",410:"대한민국",
  408:"북한",414:"쿠웨이트",418:"라오스",422:"레바논",430:"라이베리아",
  434:"리비아",440:"리투아니아",442:"룩셈부르크",450:"마다가스카르",
  454:"말라위",458:"말레이시아",462:"몰디브",466:"말리",484:"멕시코",
  496:"몽골",504:"모로코",508:"모잠비크",516:"나미비아",524:"네팔",
  528:"네덜란드",554:"뉴질랜드",558:"니카라과",566:"나이지리아",
  578:"노르웨이",512:"오만",586:"파키스탄",591:"파나마",598:"파푸아뉴기니",
  600:"파라과이",604:"페루",608:"필리핀",616:"폴란드",620:"포르투갈",
  634:"카타르",642:"루마니아",643:"러시아",646:"르완다",682:"사우디아라비아",
  686:"세네갈",694:"시에라리온",703:"슬로바키아",705:"슬로베니아",
  706:"소말리아",710:"남아프리카공화국",728:"남수단",724:"스페인",
  729:"수단",752:"스웨덴",756:"스위스",760:"시리아",158:"대만",
  762:"타지키스탄",764:"태국",768:"토고",788:"튀니지",792:"튀르키예",
  800:"우간다",804:"우크라이나",784:"아랍에미리트",826:"영국",
  840:"미국",858:"우루과이",860:"우즈베키스탄",862:"베네수엘라",
  704:"베트남",887:"예멘",894:"잠비아",716:"짐바브웨",44:"바하마",
  48:"바레인",84:"벨리즈",204:"베냉",72:"보츠와나",96:"브루나이",
  854:"부르키나파소",108:"부룬디",132:"카보베르데",214:"도미니카공화국",
  384:"코트디부아르",242:"피지",270:"감비아",478:"모리타니",480:"모리셔스",
  562:"니제르",31:"아제르바이잔",51:"아르메니아",90:"솔로몬 제도",
  112:"벨라루스",174:"코모로",226:"적도기니",232:"에리트레아",
  262:"지부티",268:"조지아",275:"팔레스타인",328:"가이아나",
  417:"키르기스스탄",426:"레소토",498:"몰도바",
  499:"몬테네그로",534:"신트마르턴",540:"누벨칼레도니",548:"바누아투",
  626:"동티모르",674:"산마리노",688:"세르비아",
  732:"서사하라",740:"수리남",780:"트리니다드 토바고",
  795:"투르크메니스탄",807:"북마케도니아"
};
function countryName(id) { return COUNTRY_NAMES[id] || ''; }
