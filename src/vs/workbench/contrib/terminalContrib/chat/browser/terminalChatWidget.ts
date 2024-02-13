/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dimension, IFocusTracker, trackFocus } from 'vs/base/browser/dom';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import 'vs/css!./media/terminalChatWidget';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { ITextModel } from 'vs/editor/common/model';
import { IModelService } from 'vs/editor/common/services/model';
import { localize } from 'vs/nls';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IChatAccessibilityService } from 'vs/workbench/contrib/chat/browser/chat';
import { IChatProgress } from 'vs/workbench/contrib/chat/common/chatService';
import { InlineChatWidget } from 'vs/workbench/contrib/inlineChat/browser/inlineChatWidget';
import { ITerminalInstance } from 'vs/workbench/contrib/terminal/browser/terminal';
import { TerminalContextKeys } from 'vs/workbench/contrib/terminal/common/terminalContextKey';
import { MENU_TERMINAL_CHAT_INPUT, MENU_TERMINAL_CHAT_WIDGET, MENU_TERMINAL_CHAT_WIDGET_FEEDBACK, MENU_TERMINAL_CHAT_WIDGET_STATUS } from 'vs/workbench/contrib/terminalContrib/chat/browser/terminalChat';

export class TerminalChatWidget extends Disposable {
	private _scopedInstantiationService: IInstantiationService;
	private _widgetContainer: HTMLElement;
	private _chatWidgetFocused: IContextKey<boolean>;
	private _chatWidgetVisible: IContextKey<boolean>;

	private readonly _inlineChatWidget: InlineChatWidget;
	private _responseWidget: CodeEditorWidget | undefined;
	private _responseElement: HTMLElement;
	private readonly _focusTracker: IFocusTracker;

	constructor(
		private readonly _container: HTMLElement,
		private readonly _instance: ITerminalInstance,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IChatAccessibilityService private readonly _chatAccessibilityService: IChatAccessibilityService,
		@IModelService private readonly _modelService: IModelService
	) {
		super();
		const scopedContextKeyService = this._register(this._contextKeyService.createScoped(this._container));
		this._scopedInstantiationService = instantiationService.createChild(new ServiceCollection([IContextKeyService, scopedContextKeyService]));
		this._chatWidgetFocused = TerminalContextKeys.chatFocused.bindTo(this._contextKeyService);
		this._chatWidgetVisible = TerminalContextKeys.chatVisible.bindTo(this._contextKeyService);
		this._widgetContainer = document.createElement('div');
		this._widgetContainer.classList.add('terminal-inline-chat');
		this._container.appendChild(this._widgetContainer);

		this._responseElement = document.createElement('div');
		this._responseElement.classList.add('terminal-inline-chat-response');
		this._widgetContainer.prepend(this._responseElement);

		// The inline chat widget requires a parent editor that it bases the diff view on, since the
		// terminal doesn't use that feature we can just pass in an unattached editor instance.
		const fakeParentEditorElement = document.createElement('div');
		const fakeParentEditor = this._scopedInstantiationService.createInstance(
			CodeEditorWidget,
			fakeParentEditorElement,
			{
				extraEditorClassName: 'ignore-panel-bg'
			},
			{ isSimpleWidget: true }
		);

		this._inlineChatWidget = this._scopedInstantiationService.createInstance(
			InlineChatWidget,
			fakeParentEditor,
			{
				menuId: MENU_TERMINAL_CHAT_INPUT,
				widgetMenuId: MENU_TERMINAL_CHAT_WIDGET,
				statusMenuId: MENU_TERMINAL_CHAT_WIDGET_STATUS,
				feedbackMenuId: MENU_TERMINAL_CHAT_WIDGET_FEEDBACK
			}
		);
		this._inlineChatWidget.placeholder = localize('default.placeholder', "Ask how to do something in the terminal");
		this._inlineChatWidget.updateInfo(localize('welcome.1', "AI-generated code may be incorrect"));
		this._widgetContainer.appendChild(this._inlineChatWidget.domNode);

		this._focusTracker = this._register(trackFocus(this._widgetContainer));
	}
	renderTerminalCommand(codeBlock: string, requestId: number): void {
		this._responseElement.classList.remove('message', 'hide');
		this._chatAccessibilityService.acceptResponse(codeBlock, requestId);
		if (!this._responseWidget) {
			this._responseWidget = this._scopedInstantiationService.createInstance(CodeEditorWidget, this._responseElement, {}, { isSimpleWidget: true });
			this._getTextModel(URI.from({ path: `terminal-inline-chat-${this._instance.instanceId}`, scheme: 'terminal-inline-chat', fragment: codeBlock })).then((model) => {
				if (!model || !this._responseWidget) {
					return;
				}
				this._responseWidget.setModel(model);
				this._responseWidget.layout(new Dimension(400, 150));
			});
		} else {
			this._responseWidget.setValue(codeBlock);
		}
	}

	renderMessage(message: string, requestId: number): void {
		this._responseElement?.classList.remove('hide');
		this._responseElement.classList.add('message');
		this._chatAccessibilityService.acceptResponse(message, requestId);
		this._responseElement.textContent = message;
	}

	private async _getTextModel(resource: URI): Promise<ITextModel | null> {
		const existing = this._modelService.getModel(resource);
		if (existing && !existing.isDisposed()) {
			return existing;
		}
		return this._modelService.createModel(resource.fragment, null, resource, false);
	}
	reveal(): void {
		this._inlineChatWidget.layout(new Dimension(400, 150));

		this._widgetContainer.classList.remove('hide');
		this._chatWidgetFocused.set(true);
		this._chatWidgetVisible.set(true);
		this._inlineChatWidget.focus();
	}
	hide(): void {
		this._responseElement?.classList.add('hide');
		this._widgetContainer.classList.add('hide');
		this._chatWidgetFocused.set(false);
		this._chatWidgetVisible.set(false);
		this._instance.focus();
	}
	cancel(): void {
		// TODO: Impl
		this._inlineChatWidget.value = '';
	}
	input(): string {
		return this._inlineChatWidget.value;
	}
	setValue(value?: string) {
		this._inlineChatWidget.value = value ?? '';
		if (!value) {
			this._responseElement?.classList.add('hide');
		}
	}
	updateProgress(progress?: IChatProgress): void {
		this._inlineChatWidget.updateProgress(progress?.kind === 'content' || progress?.kind === 'markdownContent');
	}
	layout(width: number): void {
		// this._widget?.layout(100, width < 300 ? 300 : width);
	}
	public get focusTracker(): IFocusTracker {
		return this._focusTracker;
	}
}
