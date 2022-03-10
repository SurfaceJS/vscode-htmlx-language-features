import { NotificationType } from "vscode-languageserver/node.js";

export default class CustomDataChangedNotificationRequest
{
    public static readonly type: NotificationType<string[]> = new NotificationType("html/customDataChanged");
}